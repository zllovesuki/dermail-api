var Promise = require('bluebird'),
	push = require('web-push'),
	crypto = require('crypto'),
	shortid = require('shortid');

shortid.worker(process.pid % 16);

var self = module.exports = {
	queueNewMailNotification: Promise.method(function(r, messageQ, config, payload, msg) {
		var queue = {
			type: 'new',
			message: msg
		};
		var insert = Object.assign(queue, payload);
		return messageQ.add({
			type: 'pushNotification',
			payload: insert
		}, config.Qconfig)
		.then(function() {
			var id = shortid.generate();
			insert.queueId = id;
			return r
			.table('queue')
			.insert(insert)
			.run(r.conn)
			.then(function() {
				return id;
			})
		})
	}),
	sendNotification: Promise.method(function(r, gcm_api_key, payload, subscription) {

		push.setGCMAPIKey(gcm_api_key);

		var params = {};

		var notify = function(ep, pa) {
			push.sendNotification(ep, pa);
		}

		if (typeof subscription.keys !== 'undefined') {
			params = {
				userPublicKey: subscription.keys.p256dh,
				userAuth: subscription.keys.auth,
				payload: JSON.stringify(payload)
			};
			return notify(subscription.endpoint, params);
		}else {
			var hash = crypto.createHash('sha1').update(subscription.endpoint).digest("hex");

			return r
			.table('payload')
			.insert({
				endpoint: hash,
				payload: payload
			})
			.run(r.conn)
			.then(function() {
				return notify(subscription.endpoint, params);
			})
		}
	})
}
