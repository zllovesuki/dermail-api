var express = require('express'),
	router = express.Router(),
	passport = require('passport'),
	config = require('../config'),
	formidable = require('formidable'),
	util = require('util'),
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

		var key = '/'+ fields.checksum + '/' + fields.filename;
		var fileStream = fs.createReadStream(file.path);

		s3.putStream(fileStream, key, headers, function(uploadError, uploadRes) {
			fs.unlink(file.path, function(rmError) {
				if (uploadError || rmError) {
					return res.status(500).send({
						message: 'Cannot upload attachment.'
					});
				}
				return res.status(200).send({});
			})
		});
    });


});

module.exports = router;
