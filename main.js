const report = metadata.report;
const accessToken = metadata.account.accessToken;
const instance = metadata.account.instance;
const instanceUrl = `https://${instance}.domo.com`;
const baseUrl = `${instanceUrl}/api`;

const limit = 100;
let offset = 0;
let moreData = true;
let totalCount = 0;
let body;
let url = baseUrl;
let root = report.toLowerCase();
let processData = null;
let totalProp = 'count';

httprequest.addHeader('X-DOMO-Developer-Token', accessToken);

switch (report) {
	case 'Users':
		httprequest.addHeader('Content-Type', 'application/json');
		url += '/identity/v1/users/search?explain=false';
		body = {
			showCount: true,
			includeDeleted: true,
			onlyDeleted: false,
			includeSupport: true,
			limit: limit,
			offset: offset,
			sort: {
				field: 'created',
				order: 'ASC'
			},
			attributes: [
				'id',
				'displayName',
				'department',
				'userName',
				'emailAddress',
				'phoneNumber',
				'deskPhoneNumber',
				'title',
				'timeZone',
				'hireDate',
				'modified',
				'created',
				'alternateEmail',
				'employeeLocation',
				'employeeNumber',
				'employeeId',
				'locale',
				'reportsTo',
				'isAnonymous',
				'isSystemUser',
				'isPending',
				'isActive',
				'invitorUserId',
				'lastActivity',
				'lastLogin',
				'avatarKey'
			]
		};
		processData = (users) => {
			return users.map((user) => {
				user.attributes.forEach((attribute) => {
					const key = attribute.key;
					const value = attribute.values[0]; // Assuming values array always has one element
					user[key] = value;
				});
				delete user.attributes;

				return user;
			});
		};
		break;
	case 'Functions':
		httprequest.addHeader('Content-Type', 'application/json');
		url += '/query/v1/functions/search';
		root = 'results';
		totalProp = 'totalHits';
		body = {
			name: '',
			filters: [],
			sort: {
				field: 'name',
				ascending: true
			},
			limit: limit,
			offset: offset
		};
		break;
	case 'Approval Templates':
		// Approval Templates use a special two-step GraphQL process:
		// 1. First, fetch a list of all templates with basic information
		// 2. Then, fetch detailed information for each individual template
		// This bypasses the standard pagination loop since we handle data retrieval manually
		moreData = false; // Disable the default paging loop
		httprequest.addHeader('Content-Type', 'application/json');
		url += '/synapse/approval/graphql';

		// Step 1: Get list of all templates
		body = {
			operationName: 'listTemplates',
			query:
				'query listTemplates {\n  templates {\n    id\n    title\n    titleName\n    titlePlaceholder\n    acknowledgment\n    instructions\n    description\n    providerName\n    isPublic\n    chainIsLocked\n    type\n    isPublished\n    observers {\n      id\n      type\n      displayName\n      avatarKey\n      title\n      ... on Group {\n        userCount\n        __typename\n      }\n      __typename\n    }\n    categories {\n      id\n      name\n      __typename\n    }\n    owner {\n      id\n      displayName\n      avatarKey\n      __typename\n    }\n    __typename\n  }\n}'
		};

		try {
			const response = httprequest.post(url, JSON.stringify(body));

			// Check for HTTP errors on initial template list request
			if (httprequest.getStatusCode() !== 200) {
				DOMO.log(
					'Failed to fetch template list. HTTP Status: ' +
						httprequest.getStatusCode()
				);
				datagrid.error(
					httprequest.getStatusCode(),
					'Failed to fetch template list. HTTP Status: ' +
						httprequest.getStatusCode()
				);
				break;
			}

			// Parse the response and validate structure
			let data;
			try {
				data = JSON.parse(response);
			} catch (parseError) {
				DOMO.log('Failed to parse template list response: ' + parseError);
				datagrid.error(500, 'Invalid JSON response from template list API');
				break;
			}

			// Validate GraphQL response structure
			if (!data || !data.data) {
				DOMO.log('Invalid GraphQL response structure - missing data property');
				datagrid.error(500, 'Invalid GraphQL response structure');
				break;
			}

			// Handle GraphQL errors
			if (data.errors && data.errors.length > 0) {
				DOMO.log(
					'GraphQL errors in template list: ' + JSON.stringify(data.errors)
				);
				datagrid.error(
					500,
					'GraphQL errors: ' + data.errors.map((e) => e.message).join(', ')
				);
				break;
			}

			// Check if templates array exists and has content
			if (!data.data.templates || !Array.isArray(data.data.templates)) {
				DOMO.log('No templates array found in response');
				datagrid.error(404, 'No templates found or invalid response structure');
				break;
			}

			if (data.data.templates.length === 0) {
				DOMO.log('No approval templates found');
				// This is not an error - just no data to process
				break;
			}

			const templates = data.data.templates;
			// DOMO.log(`Found ${templates.length} approval templates to process`);

			// Step 2: Get detailed information for each template
			for (let i = 0; i < templates.length; i++) {
				const currentTemplate = templates[i];

				// Validate template has required ID
				if (!currentTemplate || !currentTemplate.id) {
					DOMO.log(`Skipping template ${i} - missing ID`);
					continue;
				}

				// DOMO.log(
				// 	`Processing template ${i + 1}/${templates.length}: ${
				// 		currentTemplate.id
				// 	}`
				// );

				try {
					// Request detailed template information
					const templateDetailBody = {
						operationName: 'getTemplateForEdit',
						variables: {
							id: currentTemplate.id
						},
						query:
							'query getTemplateForEdit($id: ID!) {\n  template(id: $id) {\n    id\n    title\n    titleName\n    titlePlaceholder\n    acknowledgment\n    instructions\n    description\n    providerName\n    isPublic\n    chainIsLocked\n    type\n    isPublished\n    observers {\n      id\n      type\n      displayName\n      avatarKey\n      title\n      ... on Group {\n        userCount\n        __typename\n      }\n      __typename\n    }\n    categories {\n      id\n      name\n      __typename\n    }\n    owner {\n      id\n      displayName\n      avatarKey\n      __typename\n    }\n    fields {\n      key\n      type\n      name\n      data\n      placeholder\n      required\n      isPrivate\n      ... on SelectField {\n        option\n        multiselect\n        datasource\n        column\n        order\n        __typename\n      }\n      __typename\n    }\n    approvers {\n      type\n      originalType: type\n      key\n      ... on ApproverPerson {\n        id: approverId\n        approverId\n        userDetails {\n          id\n          displayName\n          title\n          avatarKey\n          isDeleted\n          __typename\n        }\n        __typename\n      }\n      ... on ApproverGroup {\n        id: approverId\n        approverId\n        groupDetails {\n          id\n          displayName\n          userCount\n          isDeleted\n          __typename\n        }\n        __typename\n      }\n      ... on ApproverPlaceholder {\n        placeholderText\n        __typename\n      }\n      __typename\n    }\n    workflowIntegration {\n      modelId\n      modelVersion\n      startName\n      modelName\n      parameterMapping {\n        fields {\n          field\n          parameter\n          required\n          type\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  categories {\n    id\n    name\n    __typename\n  }\n}'
					};

					const templateResponse = httprequest.post(
						url,
						JSON.stringify(templateDetailBody)
					);

					// Check for HTTP errors on individual template request
					if (httprequest.getStatusCode() !== 200) {
						DOMO.log(
							`Failed to fetch details for template ${
								currentTemplate.id
							}. HTTP Status: ${httprequest.getStatusCode()}`
						);
						// Continue processing other templates rather than failing completely
						continue;
					}

					// Parse template detail response
					let templateData;
					try {
						templateData = JSON.parse(templateResponse);
					} catch (parseError) {
						DOMO.log(
							`Failed to parse template detail response for ${currentTemplate.id}: ${parseError}`
						);
						continue;
					}

					// Validate GraphQL response structure
					if (!templateData || !templateData.data) {
						DOMO.log(
							`Invalid GraphQL response structure for template ${currentTemplate.id} - missing data property`
						);
						continue;
					}

					// Handle GraphQL errors for individual template
					if (templateData.errors && templateData.errors.length > 0) {
						DOMO.log(
							`GraphQL errors for template ${
								currentTemplate.id
							}: ${JSON.stringify(templateData.errors)}`
						);
						continue;
					}

					// Validate template data exists
					if (!templateData.data.template) {
						DOMO.log(`No template data found for ID ${currentTemplate.id}`);
						continue;
					}

					// Process and output the template data
					const processedTemplate = [templateData.data.template];
					const transformedData = arraysToStrings(processedTemplate);
					datagrid.magicParseJSON(JSON.stringify(transformedData));
				} catch (templateError) {
					DOMO.log(
						`Unexpected error processing template ${currentTemplate.id}: ${templateError}`
					);
					// Continue with next template
					continue;
				}
			}

			// DOMO.log('Completed processing all approval templates');
		} catch (generalError) {
			DOMO.log(
				'Unexpected error in Approval Templates processing: ' + generalError
			);
			datagrid.error(
				500,
				'Unexpected error processing approval templates: ' + generalError
			);
		}
		break;
	default:
		datagrid.error(0, report + ' is not a supported report');
}

while (moreData) {
	body.offset = offset;
	const response = httprequest.post(url, JSON.stringify(body));
	let data = JSON.parse(response);
	if (httprequest.getStatusCode() == 200) {
		if (data[root] && data[root].length > 0) {
			let transformedData = data[root];
			if (processData) {
				transformedData = processData(data[root]);
			}
			// 	DOMO.log(JSON.stringify(transformedData));
			transformedData = arraysToStrings(transformedData);
			datagrid.magicParseJSON(JSON.stringify(transformedData));

			totalCount += data[root].length;
			offset += limit;

			if (totalCount >= data[totalProp]) {
				moreData = false;
			}
		} else {
			// No more data returned, stop loop
			moreData = false;
		}
	} else {
		// Gracefully handle an http error
		DOMO.log('Received Http Error: ' + httprequest.getStatusCode());
		datagrid.error(
			httprequest.getStatusCode(),
			'Received HTTP error: ' + httprequest.getStatusCode()
		);
	}
}

function arraysToStrings(obj) {
	if (Array.isArray(obj)) {
		// If obj is an array, process each element but do NOT stringify the root array
		return obj.map((item) => arraysToStrings(item));
	} else if (obj !== null && typeof obj === 'object') {
		for (const key in obj) {
			if (Array.isArray(obj[key])) {
				obj[key] = JSON.stringify(obj[key]);
			} else if (typeof obj[key] === 'object' && obj[key] !== null) {
				obj[key] = arraysToStrings(obj[key]);
			}
		}
	}
	return obj;
}
