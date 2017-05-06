var Promise = require('bluebird'),
    r = require('rethinkdb'),
	config = require('../config');

r.connect(config.rethinkdb).then(function(conn) {
    r.conn = conn;
    return Promise.all([
        // create index
        r.table('messages').indexCreate('attachmentChecksum', r.row('attachments')('checksum'), {multi: true}).run(r.conn),
        r.table('messages').indexCreate('attachmentContentId', r.row('attachments')('contentId'), {multi: true}).run(r.conn)
    ])
    .then(function() {
        return r.table('messages')
        .pluck('attachments', 'messageId')
        .filter(function(doc) {
            return doc('attachments').count().gt(0)
        })
        .map(function(doc) {
            return doc.merge(function() {
                return {
                    'attachments': doc('attachments').concatMap(function(attachment) {
                        return [r.table('attachments').get(attachment)]
                    })
                }
            })
        })
        .forEach(function(doc) {
            return r.table('messages').get(doc('messageId')).update({
                attachments: r.liter(doc('attachments').without('attachmentId'))
            })
        })
        .run(r.conn)
    })
    .then(function() {
        r.conn.close();
    })
})
