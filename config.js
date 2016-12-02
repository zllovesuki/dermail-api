module.exports = {
	apiVersion: 2,
	cluster: {
		basePort: 2000
	},
	rethinkdb: require('./config.json').rethinkdb,
	graylog: require('./config.json').graylog || null,
	behindProxy: require('./config.json').behindProxy,
	s3: require('./config.json').s3,
	remoteSecret: require('./config.json').remoteSecret,
	jwt: {
		secret: require('./config.json').jwt,
	},
	gcm_api_key: require('./config.json').gcm_api_key,
	tx: require('./config.json').tx,
	domainName: require('./config.json').domainName || null
}
