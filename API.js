var r = require('rethinkdb'),
    Promise = require('bluebird'),
    geoipfind = require('geoipfind'),
	config = require('./config'),
	bunyan = require('bunyan'),
	stream = require('gelf-stream'),
	log;

if (!!config.graylog) {
	log = bunyan.createLogger({
		name: 'API',
		streams: [{
			type: 'raw',
			stream: stream.forBunyan(config.graylog.host, config.graylog.port)
		}]
	});
}else{
	log = bunyan.createLogger({
		name: 'API'
	});
}

r.connect(config.rethinkdb).then(function(conn) {
    r.conn = conn;
    var geoIP = geoipfind.geoIP('./db', function(e) {
        if (!e) return;
        log.error(e);
        process.exit(1);
    });
    var app = require('./app')(r, geoIP);
    var port = config.cluster.basePort + parseInt(process.env.NODE_APP_INSTANCE);
    var server = app.listen(port);
    var io = require('socket.io')(server);
    require('./lib/socket')(io, r, config);
    log.info('Process ' + process.pid + ' is listening on port ' + port + ' to incoming API requests.')
});
