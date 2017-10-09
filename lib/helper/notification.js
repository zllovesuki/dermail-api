var Promise = require('bluebird'),
	push = require('web-push'),
    pushOver = require('pushover-notifications'),
	crypto = require('crypto'),
	shortid = require('shortid');

shortid.worker(process.pid % 16);

var self = module.exports = {
	queueNewMailNotification: Promise.method(function(r, messageQ, config, payload) {
		var queue = {
			type: 'new'
		};
		var insert = Object.assign(queue, payload);
		var id = shortid.generate();
		insert.queueId = id;
		return r
		.table('queue')
		.insert(insert)
		.run(r.conn)
		.then(function() {
			if (!payload.push) return;
            var job = messageQ.createJob({
				type: 'pushNotification',
				payload: insert
			}).setTimeout(15 * 60 * 1000).setRetryMax(50).setRetryDelay(2 * 1000)
			return messageQ.addJob(job);
		})
	}),
	sendNotification: Promise.method(function(r, gcm_api_key, payload, subscription) {

        if (typeof subscription.token !== 'undefined' && typeof subscription.user !== 'undefined') {
            // pushover
            var p = new pushOver({
                token: subscription.token,
                user: subscription.user
            })
            var msg = {
                title: payload.message,
                message: payload.body
            }
            if (payload.folder && payload.message) {
                msg.url = subscription.root + '/accounts/' + payload.accountId + '/' + payload.folder.folderId + '/' + payload.messageId
            }else{
                msg.url = subscription.root + '/accounts/' + payload.accountId
            }
            return p.send(msg)
        }else{
            push.setGCMAPIKey(gcm_api_key);

    		if (typeof subscription.keys !== 'undefined') {
                return push.sendNotification(subscription, JSON.stringify(payload))
    		}
        }

	}),
	sendAlert: Promise.method(function(r, userId, level, msg) {
		var insert = {};
		insert.userId = userId;
		insert.type = 'notification';
		insert.level = level;
		insert.message = msg;
		return r
		.table('queue')
		.insert(insert)
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(queueId) {
			return queueId;
		})
	}),
	sendDebug: Promise.method(function(r, userId, level, msg) {
		var insert = {};
		insert.userId = userId;
		insert.type = 'debug';
		insert.level = level;
		insert.message = msg;
		return r
		.table('queue')
		.insert(insert)
		.getField('generated_keys')
		.do(function (keys) {
			return keys(0);
		})
		.run(r.conn)
		.then(function(queueId) {
			return queueId;
		})
	}),
	checkAccountNotify: Promise.method(function(r, accountId) {
		return r
		.table('accounts', {readMode: 'majority'})
		.get(accountId)
		.do(function(doc) {
			return {
				notify: r.branch(doc.hasFields('notify'), doc('notify'), true)
			}
		})
		.run(r.conn)
		.then(function(result) {
			return result.notify;
		})
		.catch(function() {
			return false;
		})
	})
}
