var r = require('rethinkdb'),
	config = require('./config');

r.connect(config.rethinkdb).then(function(conn) {
	r.conn = conn;
	var port = config.cluster.basePort - 1;
	var io = require('socket.io')(port);
	require('./lib/socket')(io, r, config);

	console.log('Process ' + process.pid + ' is listening on port ' + port + ' to incoming Socket.io connections.')
});
