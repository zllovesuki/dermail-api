var Promise = require('bluebird'),
    r = require('rethinkdb'),
	config = require('../config');

r.connect(config.rethinkdb).then(function(conn) {
    r.conn = conn;
    return r.table('messages')
    .eqJoin('headers', r.table('messageHeaders'))
    .zip()
    .filter(function(doc) {
        return doc.hasFields('<?xml version="1.0" encoding="utf-8"?>')
    })
    .forEach(function(doc) {
        return [
            r.table('messageHeaders').get(doc('headerId')).delete(),
            r.table('messages').get(doc('messageId')).delete()
        ]
    })
    .run(r.conn)
    .then(function() {
        return r.table('messages')
        .eqJoin('headers', r.table('messageHeaders'))
        .forEach(function(row) {
            return r.table('messages')
            .get(row('left')('messageId'))
            .update({
                headers: r.literal(row('right').without('headerId'))
            })
        })
        .run(r.conn)
    })
    .then(function() {
        r.conn.close()
    })
})
