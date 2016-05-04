var express = require('express'),
	router = express.Router(),
	jwt = require('jwt-simple'),
	bcrypt = require("bcrypt");

router.post('/', function(req, res, next) {

	var config = req.config;
	var r = req.r;

	var username = req.body.username;
	var password = req.body.password;

	if (!username || !password) {
		return res.status(400).send({message: 'Username and password are required'});
	}

	return r
	.table('users')
	.getAll(username, {index: 'username'})
	.pluck('userId', 'password')
	.run(r.conn)
	.then(function(cursor) {
		return cursor.toArray();
	})
	.then(function(user) {
		if (user.length === 0) {
			return res.status(403).send({message: 'Username or Password incorrect'});
		}
		bcrypt.compare(password, user[0].password, function(err, result) {
			if (err || !result) {
				return res.status(403).send({message: 'Username or Password incorrect'});
			}else{
				return r
				.table('users')
				.get(user[0].userId)
				.pluck('userId')
				.merge(function(doc) {
					return {
						'accounts': r
							.table('accounts')
							.getAll(
								doc('userId'),
								{
									index: 'userId'
								}
							)
							.concatMap(function(d) {
								return [ d('accountId') ]
							})
							.coerceTo('array')
					}
				})
				.run(r.conn)
				.then(function(user) {
					return res.status(200).send({token: jwt.encode(user, config.jwt.secret)});
				})
			}
		})
	})
	.error(function(e) {
		return next(e);
	})
});

module.exports = router;
