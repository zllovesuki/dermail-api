module.exports = {
	apiVersion: 2,
	cluster: {
		basePort: 2000
	},
	rethinkdb: require('./config.json').rethinkdb,
	'redisQ': require('./config.json').redisQ,
	'Qconfig': {
		attempts: 10,
		backoff: {
			type: 'exponential',
			delay: 2000
		}
	},
	s3: require('./config.json').s3,
	remoteSecret: require('./config.json').remoteSecret,
	jwt: {
		secret: require('./config.json').jwt,
	},
	gcm_api_key: require('./config.json').gcm_api_key,
	tx: require('./config.json').tx
}
