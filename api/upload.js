var express = require('express'),
	router = express.Router(),
	passport = require('passport'),
	config = require('../config'),
	formidable = require('formidable'),
	crypto = require('crypto'),
	fs = require('fs'),
	knox = require('knox'),
	s3 = knox.createClient(config.s3);

var auth = passport.authenticate('jwt', { session: false });

router.post('/s3Stream', auth, function(req, res, next) {

	var form = new formidable.IncomingForm();

    form.parse(req, function(err, fields, files) {

		var file = files.attachment;
		var headers = {
			'Content-Length': file.size,
			'Content-Type': file.type
		};

		var hash = crypto.createHash('md5');
		var hashStream = fs.createReadStream(file.path);

		hashStream.on('data', function(data) {
			hash.update(data, 'utf8');
		});

		hashStream.on('error', function(e) {
			return res.status(500).send({
				message: 'Cannot calculate the checksum of attachment.'
			});
		});

		hashStream.on('end', function() {
			var checksum = hash.digest('hex');
			var key = '/'+ checksum + '/' + fields.filename;
			var uploadStream = fs.createReadStream(file.path);
			s3.putStream(uploadStream, key, headers, function(uploadError, uploadRes) {
				fs.unlink(file.path, function(rmError) {
					if (uploadError || rmError) {
						return res.status(500).send({
							message: 'Cannot upload attachment.'
						});
					}
					return res.status(200).send({});
				})
			});
		})
    });


});

module.exports = router;
