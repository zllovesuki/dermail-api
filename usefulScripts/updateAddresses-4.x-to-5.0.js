var Promise = require('bluebird'),
    r = require('rethinkdb'),
    _ = require('lodash'),
	config = require('../config'),
	request = require('superagent'),
	crypto = require('crypto'),
	dkim = require('../lib/haraka/dkim'),
	SPF = require('../lib/haraka/spf').SPF,
    MailParser = require('mailparser').MailParser;

var onS3 = {};
var inDB = {};
var raw = {};
var connections = {};

r.connect(config.rethinkdb).then(function(conn) {
    r.conn = conn;

    return Promise.all([
        // create index
        r.table('accounts').indexCreate('friendlyName', r.row('addresses')('name'), {multi: true}).run(r.conn),
        r.table('accounts').indexCreate('addresses', r.row('addresses')('address'), {multi: true}).run(r.conn)
    ])
    .then(function() {
        // re-parse from raw messages to update all address fields
        return r.table('messages')
        .pluck('connection', 'messageId')
        .run(r.conn)
        .then(function(cursor) {
            return cursor.toArray();
        })
        .then(function(results) {
            return results.map(function(res) {
                if (res.connection) {
                    var tmpPath = res.connection.tmpPath;
                    var hash = crypto.createHash('md5')
                    hash.update(tmpPath);
                    var md5 = hash.digest('hex');
                    return {
                        connection: res.connection,
                        messageId: res.messageId,
                        checksum: md5
                    }
                }
            })
        })
        .then(function(results) {
            return Promise.map(results, function(res) {
                if (!res) return;
                return new Promise(function(resolve, reject) {
                    var mailParser = new MailParser({
                        streamAttachments: true
                    });

                    mailParser.on('end', function (mail) {
                        if (res.connection) {
                            mail._date = _.clone(mail.date);
                            mail.date = res.connection.date;
                        }

                        mail.to = mail.to || [];
                		mail.from = mail.from || [];
                		mail.cc = mail.cc || [];
                		mail.bcc = mail.bcc || [];
                        return r.table('messages')
                        .get(res.messageId)
                        .update({
                            to: mail.to,
                            from: mail.from,
                            cc: mail.cc,
                            bcc: mail.bcc
                        })
                        .run(r.conn)
                        .then(resolve)
                    })

                    request.get([
                        'https://',
                        config.s3.endpoint,
                        '/',
                        config.s3.bucket,
                        '/raw/',
                        res.checksum
                    ].join('')).pipe(mailParser);
                });
            }, { concurrency: 10 })
        })
    })
    .then(function() {
        // move from table `addresses` under owner
        return r.table('addresses').filter(function(doc) {
            return r.not(doc('internalOwner').eq(null))
        }).forEach(function(doc) {
            return r.table('accounts')
                .get(doc('accountId'))
                .update(function(row) {
                    return {
                        addresses: r.branch(row.hasFields('addresses'), row('addresses').append({
                            name: doc('friendlyName'),
                            address: r.add(doc('account'), '@', doc('domain')),
                            isAlias: doc.hasFields('aliasOf')
                        }), [{
                            name: doc('friendlyName'),
                            address: r.add(doc('account'), '@', doc('domain')),
                            isAlias: doc.hasFields('aliasOf')
                        }])
                    }
                })
        })
    })
    .then(function() {
        // Update TX messages
        return r.table('messages')
        .filter(function(doc) {
            return doc.hasFields('TXExtra')
        })
        .pluck('to', 'from', 'cc', 'bcc', 'messageId')
        .map(function(doc) {
            return doc.merge(function() {
                return {
                    cc: r.branch(doc.hasFields('cc'), doc('cc'), []),
                    bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), []),
                }
            })
        })
        .map(function(doc) {
            return doc.merge(function() {
                return {
                    to: doc('to').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                    from: doc('from').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                    cc: doc('cc').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                    bcc: doc('bcc').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                }
            })
        })
        .forEach(function(doc) {
            return r.table('messages')
            .get(doc('messageId'))
            .update(doc)
        })
        .run(r.conn)
    })
    .then(function() {
        // legacy migration
        return r.table('messages')
        .filter(function(doc) {
            return r.not(doc.hasFields('connection')).and(r.not(doc.hasFields('TXExtra')))
        })
        .pluck('to', 'from', 'cc', 'bcc', 'messageId')
        .map(function(doc) {
            return doc.merge(function() {
                return {
                    cc: r.branch(doc.hasFields('cc'), doc('cc'), []),
                    bcc: r.branch(doc.hasFields('bcc'), doc('bcc'), []),
                }
            })
        })
        .map(function(doc) {
            return doc.merge(function() {
                return {
                    to: doc('to').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                    from: doc('from').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                    cc: doc('cc').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                    bcc: doc('bcc').concatMap(function(addr) {
                        return [r.table('addresses').get(addr).without('accountId', 'addressId', 'internalOwner')]
                    }).map(function(a) {
                        return {
                            address: a('account').add('@').add(a('domain')),
                            name: a('friendlyName')
                        }
                    }),
                }
            })
        })
        .forEach(function(doc) {
            return r.table('messages')
            .get(doc('messageId'))
            .update(doc)
        })
        .run(r.conn)
    })
    .then(function() {
        r.conn.close();
    })
})
