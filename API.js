var r = require('rethinkdb'),
	config = require('./config');

r.connect(config.rethinkdb).then(function(conn) {
	r.conn = conn;
	var app = require('./app')(r);
	var port = config.cluster.basePort + parseInt(process.env.NODE_APP_INSTANCE);
	var server = app.listen(port);

	console.log('Process ' + process.pid + ' is listening on port ' + port + ' to incoming API requests.')
});
