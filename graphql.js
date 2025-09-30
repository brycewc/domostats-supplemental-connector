// =====================================
// Dynamic GraphQL Report Executor
// =====================================
// Goal: Easily add future report types by only updating the reportsConfig.
// Supported modes:
//   pagination  - standard limit/offset loop (Approvals style)
//   multiFetch  - fetch a list, then fetch details per item (Approval Templates)
// Anything truly unique can be implemented with a custom execute override.

const report = metadata.report; // Name selected in UI
const accessToken = metadata.account.accessToken;
const instance = metadata.account.instance;
const instanceUrl = `https://${instance}.domo.com`;
const baseUrl = `${instanceUrl}/api`;
const url = baseUrl + '/synapse/approval/graphql';

httprequest.addHeader('X-DOMO-Developer-Token', accessToken);
httprequest.addHeader('Content-Type', 'application/json');

// ------------------------------
// Utility helpers
// ------------------------------
function safePost(bodyObj) {
	try {
		const raw = httprequest.post(url, JSON.stringify(bodyObj));
		const status = httprequest.getStatusCode();
		let json = null;
		if (raw && status === 200) {
			try {
				json = JSON.parse(raw);
			} catch (e) {
				return { status, error: 'Invalid JSON: ' + e, raw };
			}
		}
		if (status !== 200) {
			return { status, error: 'HTTP ' + status, raw, json };
		}
		if (json && json.errors && json.errors.length > 0) {
			return {
				status,
				error: 'GraphQL: ' + json.errors.map((e) => e.message).join('; '),
				raw,
				json
			};
		}
		return { status, json, raw };
	} catch (err) {
		return {
			status: httprequest.getStatusCode(),
			error: 'Request exception: ' + err
		};
	}
}

function getPath(obj, path) {
	if (!obj || !path) return undefined;
	const parts = path.split('.');
	let cur = obj;
	for (let i = 0; i < parts.length; i++) {
		if (cur == null) return undefined;
		cur = cur[parts[i]];
	}
	return cur;
}

function arraysToStrings(obj) {
	if (Array.isArray(obj)) {
		return obj.map((item) => arraysToStrings(item));
	} else if (obj !== null && typeof obj === 'object') {
		for (const key in obj) {
			if (Array.isArray(obj[key])) {
				obj[key] = JSON.stringify(obj[key]);
			} else if (obj[key] && typeof obj[key] === 'object') {
				obj[key] = arraysToStrings(obj[key]);
			}
		}
	}
	return obj;
}

function outputRows(rows) {
	if (!rows) return;
	const arr = Array.isArray(rows) ? rows : [rows];
	const transformed = arraysToStrings(arr);
	datagrid.magicParseJSON(JSON.stringify(transformed));
}

// ------------------------------
// Report Config Definitions
// ------------------------------
// To add a new report:
// 1. Add an entry with either mode: 'pagination' or 'multiFetch'.
// 2. Supply builders / paths. Keep queries tight for performance.
// 3. (Optional) Provide transformItems(items, context) for row-level shaping.

const reportsConfig = {
	// ========================= Approvals (Cursor Pagination) =========================
	Approvals: {
		mode: 'cursorPagination',
		// buildRequest receives { cursor, page } and should return GraphQL body
		buildRequest: ({ cursor }) => ({
			operationName: 'searchApprovalRequests',
			variables: {
				after: cursor || null,
				reverseSort: false // adjust if needed
				// If the API expects a query variable, add it here e.g. query: "" or filters
			},
			query: `query searchApprovalRequests($query: String, $after: ID, $reverseSort: Boolean) {
      workflowSearch(
        query: $query
        type: "AC"
        after: $after
        reverseSort: $reverseSort
      ) {
        edges {
          cursor
          node {
            approval {
              id
              title
              templateID
              templateTitle
              status
              modifiedTime
              version
              providerName
              approvalChainIdx
              pendingApprover: pendingApproverEx {
                id
                type
                displayName
                ... on User { title avatarKey __typename }
                ... on Group { isDeleted __typename }
                __typename
              }
              submitter {
                id
                type
                displayName
                avatarKey
                isCurrentUser
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
          __typename
        }
        __typename
      }
    }`
		}),
		// Path to edges array
		edgesPath: 'data.workflowSearch.edges',
		pageInfoPath: 'data.workflowSearch.pageInfo',
		// Map edges -> row objects output. Flatten approval node for dataset rows.
		transformEdges: (edges) => {
			const rows = [];
			for (let i = 0; i < edges.length; i++) {
				const e = edges[i];
				if (!e || !e.node || !e.node.approval) continue;
				// Spread approval fields; retain cursor for lineage if desired
				const row = e.node.approval;
				row._edgeCursor = e.cursor; // optional metadata column
				rows.push(row);
			}
			return rows;
		}
	},

	// ========================= Approval Templates (List + Detail) =========================
	'Approval Templates': {
		mode: 'multiFetch',
		list: {
			buildRequest: () => ({
				operationName: 'listTemplates',
				query: `query listTemplates {
		  templates { id title titleName __typename }
		}`
			}),
			listPath: 'data.templates'
		},
		detail: {
			buildRequest: (template) => ({
				operationName: 'getTemplateForEdit',
				variables: { id: template.id },
				query: `query getTemplateForEdit($id: ID!) {
		  template(id: $id) {
		    id
		    title
		    titleName
		    titlePlaceholder
		    acknowledgment
		    instructions
		    description
		    providerName
		    isPublic
		    chainIsLocked
		    type
		    isPublished
		    observers { id type displayName avatarKey title ... on Group { userCount __typename } __typename }
		    categories { id name __typename }
		    owner { id displayName avatarKey __typename }
		    fields {
		      key type name data placeholder required isPrivate
		      ... on SelectField { option multiselect datasource column order __typename }
		      __typename
		    }
		    approvers {
		      type originalType: type key
		      ... on ApproverPerson { id: approverId approverId userDetails { id displayName title avatarKey isDeleted __typename } __typename }
		      ... on ApproverGroup { id: approverId approverId groupDetails { id displayName userCount isDeleted __typename } __typename }
		      ... on ApproverPlaceholder { placeholderText __typename }
		      __typename
		    }
		    workflowIntegration {
		      modelId modelVersion startName modelName
		      parameterMapping { fields { field parameter required type __typename } __typename }
		      __typename
		    }
		    __typename
		  }
		}`
			}),
			detailPath: 'data.template',
			idField: 'id'
		}
	}
};

// ------------------------------
// Executors
// ------------------------------
function executePagination(cfg) {
	let offset = 0;
	const limit = cfg.limit || 100;
	let page = 0;
	while (true) {
		const body = cfg.buildRequest({ offset, limit, page });
		const resp = safePost(body);
		if (resp.error) {
			DOMO.log('Pagination request failed: ' + resp.error);
			if (resp.status) datagrid.error(resp.status, resp.error);
			else datagrid.error(500, resp.error);
			return; // stop on error
		}
		const items = getPath(resp.json, cfg.dataPath) || [];
		if (!Array.isArray(items) || items.length === 0) {
			// No more rows
			return;
		}
		let out = items;
		if (cfg.transformItems) {
			try {
				out = cfg.transformItems(items, { offset, page, json: resp.json });
			} catch (e) {
				DOMO.log('transformItems error: ' + e);
			}
		}
		outputRows(out);
		const total = cfg.totalPath ? getPath(resp.json, cfg.totalPath) : undefined;
		if (!cfg.hasMore({ items, total, offset, limit, page, json: resp.json })) {
			return;
		}
		offset += limit;
		page += 1;
	}
}

function executeMultiFetch(cfg) {
	// 1. Fetch list
	const listResp = safePost(cfg.list.buildRequest());
	if (listResp.error) {
		DOMO.log('List request failed: ' + listResp.error);
		datagrid.error(listResp.status || 500, listResp.error);
		return;
	}
	const list = getPath(listResp.json, cfg.list.listPath) || [];
	if (!Array.isArray(list) || list.length === 0) {
		DOMO.log('No items returned for multiFetch list: ' + cfg.list.listPath);
		return; // Not an error, just empty
	}
	for (let i = 0; i < list.length; i++) {
		const item = list[i];
		const idField = cfg.detail.idField || 'id';
		if (!item || !item[idField]) {
			DOMO.log('Skipping item missing idField ' + idField + ' at index ' + i);
			continue;
		}
		const detailBody = cfg.detail.buildRequest(item);
		const detailResp = safePost(detailBody);
		if (detailResp.error) {
			DOMO.log(
				'Detail fetch failed for ' + item[idField] + ': ' + detailResp.error
			);
			continue; // skip; don't abort whole run
		}
		const detailObj = getPath(detailResp.json, cfg.detail.detailPath);
		if (!detailObj) {
			DOMO.log('No detail object found for ' + item[idField]);
			continue;
		}
		outputRows(detailObj);
	}
}

function executeCursorPagination(cfg) {
	let cursor = null;
	let page = 0;
	while (true) {
		const body = cfg.buildRequest({ cursor, page });
		const resp = safePost(body);
		if (resp.error) {
			DOMO.log('Cursor pagination request failed: ' + resp.error);
			datagrid.error(resp.status || 500, resp.error);
			return;
		}
		const edges = getPath(resp.json, cfg.edgesPath) || [];
		if (!Array.isArray(edges) || edges.length === 0) {
			return; // no more
		}
		let rows = edges;
		if (cfg.transformEdges) {
			try {
				rows = cfg.transformEdges(edges, { cursor, page, json: resp.json });
			} catch (e) {
				DOMO.log('transformEdges error: ' + e);
			}
		}
		outputRows(rows);
		const pageInfo = getPath(resp.json, cfg.pageInfoPath) || {};
		if (!pageInfo.hasNextPage) return;
		cursor = pageInfo.endCursor;
		if (!cursor) return; // safety
		page += 1;
	}
}

function executeReport(name) {
	const cfg = reportsConfig[name];
	if (!cfg) {
		datagrid.error(0, name + ' is not a supported report');
		return;
	}
	try {
		if (cfg.execute) return cfg.execute();
		switch (cfg.mode) {
			case 'pagination':
				executePagination(cfg);
				break;
			case 'cursorPagination':
				executeCursorPagination(cfg);
				break;
			case 'multiFetch':
				executeMultiFetch(cfg);
				break;
			default:
				datagrid.error(500, 'Unsupported mode for report: ' + name);
		}
	} catch (err) {
		DOMO.log('Unexpected error executing report ' + name + ': ' + err);
		datagrid.error(500, 'Unexpected error: ' + err);
	}
}

// Execute selected report
executeReport(report);
