const url = 'https://domo.domo.com/api/identity/v1/users/search?explain=false';
const limit = 50;
let offset = 0;
let moreData = true;
let totalCount = 0;

httprequest.addHeader('X-DOMO-Developer-Token', metadata.account.accessToken);
httprequest.addHeader('Content-Type', 'application/json');

let body = {
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

while (moreData) {
	body.offset = offset;
	const response = httprequest.post(url, JSON.stringify(body));
	let data = JSON.parse(response);
	if (httprequest.getStatusCode() == 200) {
		if (data.users && data.users.length > 0) {
			const transformedUsers = data.users.map((user) => {
				user.attributes.forEach((attribute) => {
					const key = attribute.key;
					const value = attribute.values[0]; // Assuming values array always has one element
					user[key] = value;
				});
				delete user.attributes;

				return user;
				// DOMO.log(JSON.stringify(user));
			});
			// 	DOMO.log(JSON.stringify(transformedUsers));
			datagrid.magicParseJSON(JSON.stringify(transformedUsers));

			totalCount += data.users.length;
			offset += limit;

			if (totalCount >= data.count) {
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
