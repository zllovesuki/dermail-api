var r = require('rethinkdb'),
	config = require('./config');

r.connect(config.rethinkdb).then(function(conn) {

	r.conn = conn;
	require('./lib/gcm')(r, config); // Only one instance to do notification

	console.log('Process ' + process.pid + ' is running as GCM helper.')
});
