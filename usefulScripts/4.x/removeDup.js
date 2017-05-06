var config = require('../config'),
	r = require('rethinkdb'),
    crypto = require('crypto');

var hash = {}, tmp = '', dup = [];

r.connect(config.rethinkdb).then(function(conn) {
    r.table('messages')
    .orderBy(r.asc('savedOn'))
    .pluck('messageId', 'connection')
    .run(conn)
    .then(function(cursor) {
        return cursor.toArray()
    })
    .then(function(messages) {
        messages.forEach(function(message) {
            if (!message.connection) return;
            tmp = crypto.createHash('md5').update(JSON.stringify(message.connection)).digest('hex');
            if (typeof hash[tmp] === 'undefined') hash[tmp] = message.messageId;
            else dup.push(message.messageId)
        })
    })
    .then(function() {
        return r.table('messages')
        .getAll(r.args(dup))
        .delete()
        .run(conn)
        .then(function() {
            console.log(dup)
            return conn.close();
        })
    })
})
