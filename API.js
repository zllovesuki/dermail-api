var r = require('rethinkdb'),
    Promise = require('bluebird'),
    ip2asn = require('ip2asn')(),
	config = require('./config'),
	bunyan = require('bunyan'),
	stream = require('gelf-stream'),
    discover = require('./lib/discover'),
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

var endpoint = false;

discover().then(function(ip) {
    if (ip !== null) {
        config.rethinkdb.host = ip;
        endpoint = ip;
    }
    r.connect(config.rethinkdb).then(function(conn) {
        r.conn = conn;
        var opts = { url: 'https://dermail.objectstore.co/files/GeoIm2.zip' };
        ip2asn.lastUpdated(function(err, t) {
            if (err) {
                log.error(e)
            }else{
                if (t > 29) {
                    opts.update = true;
                }
                ip2asn.load(opts);
            }
        });
        ip2asn.on('ready', function() {
            var app = require('./app')(r, ip2asn, endpoint);
            var port = config.cluster.basePort;
            var server = app.listen(port);
            var io = require('socket.io')(server);
            require('./lib/socket')(io, r, config);
            log.info('Process ' + process.pid + ' is listening on port ' + port + ' to incoming API requests.')
        })
    });
})
