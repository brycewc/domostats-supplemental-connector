const accessToken = metadata.account.accessToken;
const instance = metadata.account.instance;

if (accessToken.match(/^[a-zA-Z0-9]+$/)) {
	if (instance.match(/^(?!.*\bdomo\\.com\b)\w[\w.-]+\w$/gm)) {
		httprequest.addHeader('X-DOMO-Developer-Token', accessToken);

		let res = httprequest.get(
			`https://${instance}.domo.com/api/dataprocessing/v1/dataflows/timezones`
		);

		if (httprequest.getStatusCode() == 200) {
			auth.authenticationSuccess();
		} else {
			auth.authenticationFailed(
				'The access token you entered is invalid. Please try again with a access token.'
			);
		}
	} else {
		auth.authenticationFailed(
			'Your provided instance did not pass regex validation. Ensure you only include the instance name, without https:// and without .domo.com'
		);
	}
} else {
	auth.authenticationFailed(
		'Your provided credentials did not pass regex validation. Please check your access token format and try again.'
	);
}
