var r = require('rethinkdb'),
	config = require('../config'),
	helper = require('../lib/helper'),
	Promise = require('bluebird');

var deleted = [];

r.connect(config.rethinkdb).then(function(conn) {
	r.conn = conn;
    return Promise.all([
        r.table('messages')
        .pluck('to', 'from', 'cc', 'bcc')
        .map(function(row) {
            return row.merge(function(doc) {
                return {
                    cc: r.branch(doc.hasFields('cc'), doc('cc'), []),
                    bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), [])
                }
            })
        })
        .run(r.conn)
        .then(function(cursor) {
            return cursor.toArray()
        }),
        r.table('addresses')
    	.pluck('addressId', 'aliasOf')
    	.map(function(doc) {
    		return {
    			addressId: doc('addressId'),
    			alias: r.branch(doc.hasFields('aliasOf'), true, false)
            }
        })
        .run(r.conn)
        .then(function(cursor) {
            return cursor.toArray();
        })
    ]).spread(function(messages, addresses) {
        var bigArray = [];
        messages.forEach(function(message) {
            bigArray = bigArray.concat(message.to);
            bigArray = bigArray.concat(message.from);
            bigArray = bigArray.concat(message.cc);
            bigArray = bigArray.concat(message.bcc);
        })
        bigArray = bigArray.filter(function(elem, index, self) {
            return index == self.indexOf(elem)
        })
        addresses = addresses.map(function(address) {
            if (address.alias === false) return address.addressId;
            else return false;
        }).filter(Boolean).filter(function(address) {
            return bigArray.indexOf(address) < 0;
        })
        return r.table('addresses').getAll(r.args(addresses)).delete().run(r.conn)
        .then(function() {
    		console.log(addresses);
    		conn.close();
    	})
    })
});
