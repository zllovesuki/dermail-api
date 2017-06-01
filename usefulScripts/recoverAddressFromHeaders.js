var Promise = require('bluebird')
var r = require('rethinkdb')
var config = require('../config')
var mimelib = require("mimelib-noiconv")
var util = require('util')

r.connect().then(function(conn) {
    return r.db('dermail')
        .table('messages')
        .filter(function(row) {
            return row('from').count().eq(0).and(row('to').count().eq(0)).and(r.not(row('html').eq('<div></div>')))
        })
        .pluck('messageId', 'headers')
        .run(conn)
        .then(function(cursor) {
            return cursor.toArray();
        })
        .then(function(messages) {
            return Promise.map(messages, function(message) {
                return r.db('dermail')
                    .table('messages')
                    .get(message.messageId)
                    .update({
                        from: mimelib.parseAddresses(message.headers.from),
                        to: mimelib.parseAddresses(message.headers.to),
                        cc: (message.headers.cc ?
                            typeof message.headers.cc.map === 'function' ?
                            message.headers.cc.map(mimelib.parseAddresses).reduce(function(a, b) {
                                return a.concat(b)
                            }) :
                            mimelib.parseAddresses(message.headers.cc) :
                            []
                        ),
                        bcc: (message.headers.bcc ?
                            typeof message.headers.bcc.map === 'function' ?
                            message.headers.bcc.map(mimelib.parseAddresses).reduce(function(a, b) {
                                return a.concat(b)
                            }) :
                            mimelib.parseAddresses(message.headers.bcc) :
                            []
                        )
                    })
                    .run(conn)
            }, {
                concurrency: 10
            })
        })
        .then(function() {
            return r.db('dermail').table('messages')
                .filter(function(row) {
                    return r.not(row('headers').typeOf().eq('OBJECT'))
                })
                .delete()
                .run(conn)
        })
        .then(function() {
            conn.close()
        })
})
