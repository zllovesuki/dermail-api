var	Queue = require('rethinkdb-job-queue'),
	config = require('./config'),
	log;

if (config.qMaster !== true) {
    console.log('Not assigned as Master Queue, exiting.')
    return process.exit(0);
}

var messageQ = new Queue(config.rethinkdb, {
    name: 'jobQueue',
    // For the sake of review, we will remove finished jobs after 24 hours
    removeFinishedJobs: 24 * 60 * 60 * 1000,
    // This is a master queue
    masterInterval: (15 * 60 * 1000) + (10 * 1000)
});

if (!!config.graylog) {
	log = require('bunyan').createLogger({
		name: 'API-Queue-Master',
		streams: [{
			type: 'raw',
			stream: require('gelf-stream').forBunyan(config.graylog.host, config.graylog.port)
		}]
	});
}else{
	log = require('bunyan').createLogger({
		name: 'API-Queue-Master'
	});
}

log.info('Process ' + process.pid + ' is running as Queue Master')
