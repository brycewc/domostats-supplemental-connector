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
