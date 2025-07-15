httprequest.addHeader('X-DOMO-Developer-Token', metadata.account.accessToken);

let res = httprequest.get(
	'https://domo.domo.com/api/content/v1/customer-states/locale?ignoreCache=true'
);

if (httprequest.getStatusCode() == 200) {
	auth.authenticationSuccess();
} else {
	auth.authenticationFailed(
		'The access token you entered is invalid. Please try again with a access token.'
	);
}
