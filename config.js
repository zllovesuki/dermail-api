module.exports = {
	apiVersion: 2,
	cluster: {
		basePort: 2000
	},
	rethinkdb: require('./config/config.json').rethinkdb,
	graylog: require('./config/config.json').graylog || null,
    qMaster: require('./config/config.json').qMaster === true,
	behindProxy: require('./config/config.json').behindProxy,
	s3: require('./config/config.json').s3,
	remoteSecret: require('./config/config.json').remoteSecret,
	jwt: {
		secret: require('./config/config.json').jwt,
	},
	gcm_api_key: require('./config/config.json').gcm_api_key,
	tx: require('./config/config.json').tx,
	domainName: require('./config/config.json').domainName || null
}
