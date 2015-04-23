/*!
 * Module dependencies.
 */

var fs = require('fs-extra'),
	path = require('path'),
	_ = require('underscore'),
	moment = require('moment'),
	keystone = require('../../../'),
	util = require('util'),
	utils = require('keystone-utils'),
	super_ = require('../Type'),
	async = require('async'),
	prepost = require('../../../lib/prepost'),
	knox = require('knox');

/**
 * s3files FieldType Constructor
 * @extends Field
 * @api public
 */

function s3files(list, path, options) {
	prepost.mixin(this)
		.register('pre:upload', 'post:upload');
	
	this._underscoreMethods = ['format', 'uploadFiles'];
	this._fixedSize = 'full';

	// TODO: implement filtering, usage disabled for now
	options.nofilter = true;

	// TODO: implement initial form, usage disabled for now
	if (options.initial) {
		throw new Error('Invalid Configuration\n\n' +
			's3files fields (' + list.key + '.' + path + ') do not currently support being used as initial fields.\n');
	}
	
	if (options.overwrite !== false) {
		options.overwrite = true;
	}

	s3files.super_.call(this, list, path, options);

	// validate s3 config (has to happen after super_.call)
	if (!this.s3config) {
		throw new Error('Invalid Configuration\n\n' +
			'S3File fields (' + list.key + '.' + path + ') require the "s3 config" option to be set.\n\n' +
			'See http://keystonejs.com/docs/configuration/#services-amazons3 for more information.\n');
	}

	// Allow hook into before and after
	if (options.pre && options.pre.upload) {
		this.pre('upload', options.pre.upload);
	}

	if (options.post && options.post.upload) {
		this.post('upload', options.post.upload);
	}
	
}

/*!
 * Inherit from Field
 */

util.inherits(s3files, super_);

/**
 * Exposes the custom or keystone s3 config settings
 */

Object.defineProperty(s3files.prototype, 's3config', { get: function() {
	return this.options.s3config || keystone.get('s3 config');
}});

/**
 * Registers the field on the List's Mongoose Schema.
 *
 * @api public
 */

s3files.prototype.addToSchema = function() {

	var field = this,
		schema = this.list.schema;
	var mongoose = keystone.mongoose;

	var paths = this.paths = {
		// fields
		filename:		this._path.append('.filename'),
		path:			this._path.append('.path'),
		size:			this._path.append('.size'),
		filetype:		this._path.append('.filetype'),
		url:      		this._path.append('.url'),
		// virtuals
		exists:			this._path.append('.exists'),
		upload:			this._path.append('_upload'),
		action:			this._path.append('_action'),
		order: 			this._path.append('_order')
	};

	var schemaPaths = new mongoose.Schema({
		filename:		String,
		path:			String,
		size:			Number,
		filetype:		String,
		url:      String
	});

	schema.add(this._path.addTo({}, [schemaPaths]));

	var exists = function(item, element_id) {
		var values = item.get(field.path);
		var value;

		if (typeof values === 'undefined' || values.length === 0) {
			return false;
		}

		// if current Field contains any file, it means it exists
		if (typeof element_id === 'undefined') {
			value = values[0];
		} else {
			value = _.findWhere(values, { 'id': element_id });
		}

		if (typeof value === 'undefined') {
			return false;
		}

		var filepaths = value.path,
			filename = value.filename;

		if (!filepaths || !filename) {
			return false;
		}

		return fs.existsSync(path.join(filepaths, filename));
	};

	// The .exists virtual indicates whether a file is stored
	schema.virtual(paths.exists).get(function() {
		return schemaMethods.exists.apply(this);
	});

	var reset = function(item, element_id) {
		if (typeof element_id === 'undefined') {
			item.set(field.path, []);
		} else {
			var values = item.get(field.path);
			var value = _.findWhere(values, { 'id': element_id });
			if (typeof(value !== 'undefined')) {
				values.splice(values.indexOf(value), 1);
			}
		}
	};

	var schemaMethods = {
		exists: function() {
			return exists(this);
		},
		/**
		 * Resets the value of the field
		 *
		 * @api public
		 */
		reset: function() {
			reset(this);
		},
		/**
		 * Deletes the file from s3files and resets the field
		 *
		 * @api public
		 */
		delete: function(element_id) {
			if (exists(this, element_id)) {
				var values = this.get(field.path);
				var value = _.findWhere(values, { 'id': element_id });
				if (typeof value !== 'undefined') {
					//fs.unlinkSync(path.join(value.path, value.filename));
					var client = knox.createClient(field.s3config);
					client.deleteFile(this.get(paths.path) + this.get(paths.filename), function(err, res){ return res ? res.resume() : false; });
				}
			}
			reset(this, element_id);
		}
	};

	_.each(schemaMethods, function(fn, key) {
		field.underscoreMethod(key, fn);
	});

	// expose a method on the field to call schema methods
	this.apply = function(item, method) {
		return schemaMethods[method].apply(item, Array.prototype.slice.call(arguments, 2));
	};

	this.bindUnderscoreMethods();
};


/**
 * Formats the field value
 *
 * @api public
 */

s3files.prototype.format = function(item, i) {
	var files = item.get(this.path);
	if (typeof i === 'undefined') {
		return utils.plural(files.length, '* File');
	}
	var file = files[i];
	if (!file) return '';
	if (this.hasFormatter()) {
		file.href = this.href(file);
		return this.options.format.call(this, item, file);
	}
	return file.filename;
};


/**
 * Detects whether the field has a formatter function
 *
 * @api public
 */

s3files.prototype.hasFormatter = function() {
	return 'function' === typeof this.options.format;
};


/**
 * Return the public href for a single stored file
 *
 * @api public
 */

s3files.prototype.href = function(file) {
	if (!file.filename) return '';
	var prefix = this.options.prefix ? this.options.prefix : file.url;
	return path.join(prefix, file.filename);
};


/**
 * Detects whether the field has been modified
 *
 * @api public
 */

s3files.prototype.isModified = function(item) {
	return item.isModified(this.paths.url);
};


/**
 * Validates that a value for this field has been provided in a data object
 *
 * @api public
 */

s3files.prototype.validateInput = function(data) {
	// TODO - how should file field input be validated?
	return true;
};


/**
 * Updates the value for this field in the item from a data object
 *
 * @api public
 */

s3files.prototype.updateItem = function(item, data) {
	// TODO - direct updating of data (not via upload)
};


/**
 * Uploads the file for this field
 *
 * @api public
 */

s3files.prototype.uploadFiles = function (item, files, update, callback) {

	var field = this;

	if ('function' === typeof update) {
		callback = update;
		update = false;
	}

	async.map(files, function (file, processedFile) {

		/*var prefix = field.options.datePrefix ? moment().format(field.options.datePrefix) + '-' : '',
			filename = prefix + file.name,
			filetype = file.mimetype || file.type;
		
		if (field.options.allowedTypes && !_.contains(field.options.allowedTypes, filetype)) {
			return processedFile(new Error('Unsupported File Type: ' + filetype));
		}
		
		var doMove = function(doneMove) {
			
			if ('function' === typeof field.options.filename) {
				filename = field.options.filename(item, filename);
			}
			
			fs.move(file.path, path.join(field.options.dest, filename), { clobber: field.options.overwrite }, function(err) {
				if (err) return doneMove(err);
				
				var fileData = {
					filename: filename,
					path: field.options.dest,
					size: file.size,
					filetype: filetype
				};
				
				if (update) {
					item.get(field.path).push(fileData);
				}
				
				doneMove(null, fileData);
			});
			
		};
		
		field.hooks('pre:move', function(fn, next) {
			fn(item, file, next);
		}, function(err) {
			if (err) return processedFile(err);
			
			doMove(function(err, fileData) {
				if (err) return processedFile(err);
				
				field.hooks('post:move', function(fn, next) {
					fn(item, file, fileData, next);
				}, function(err) {
					return processedFile(err, fileData);
				});
			});
		});*/

		var field = this,
			path = field.options.s3path ? field.options.s3path + '/' : '',
			prefix = field.options.datePrefix ? moment().format(field.options.datePrefix) + '-' : '',
			filename = prefix + file.name,
			filetype = file.mimetype || file.type,
			headers;

		if ('function' === typeof update) {
			callback = update;
			update = false;
		}

		if (field.options.allowedTypes && !_.contains(field.options.allowedTypes, filetype)) {
			return callback(new Error('Unsupported File Type: ' + filetype));
		}

		var doUpload = function (done) {

			if ('function' === typeof field.options.filename) {
				filename = field.options.filename(item, filename);
			}

			headers = field.generateHeaders(item, file, callback);

			knox.createClient(field.s3config).putFile(file.path, path + filename, headers, function (err, res) {

				if (err) return done(err);
				if (res) {
					if (res.statusCode !== 200) {
						return done(new Error('Amazon returned Http Code: ' + res.statusCode));
					} else {
						res.resume();
					}
				}

				var protocol = (field.s3config.protocol && field.s3config.protocol + ':') || '',
					url = res.req.url.replace(/^https?:/i, protocol);

				var fileData = {
					filename: filename,
					path: path,
					size: file.size,
					filetype: filetype,
					url: url
				};

				if (update) {
					item.set(field.path, fileData);
				}

				done(null, fileData);

			});
		};

		field.hooks('pre:upload', function(fn, next) {
			fn(item, file, next);
		}, function(err) {
			if (err) return processedFile(err);
			
			doUpload(function(err, fileData) {
				if (err) return processedFile(err);
				
				field.hooks('post:upload', function(fn, next) {
					fn(item, file, fileData, next);
				}, function(err) {
					return processedFile(err, fileData);
				});
			});
		});

	}, callback);

};


/**
 * Returns a callback that handles a standard form submission for the field
 *
 * Expected form parts are
 * - `field.paths.action` in `req.body` (`clear` or `delete`)
 * - `field.paths.upload` in `req.files` (uploads the file to s3files)
 *
 * @api public
 */

s3files.prototype.getRequestHandler = function(item, req, paths, callback) {

	var field = this;

	if (utils.isFunction(paths)) {
		callback = paths;
		paths = field.paths;
	} else if (!paths) {
		paths = field.paths;
	}

	callback = callback || function() {};

	return function() {

		// Order
		if (req.body[paths.order]) {
			var files = item.get(field.path),
				newOrder = req.body[paths.order].split(',');

			files.sort(function(a, b) {
				return (newOrder.indexOf(a._id.toString()) > newOrder.indexOf(b._id.toString())) ? 1 : -1;
			});
		}

		// Removals
		if (req.body && req.body[paths.action]) {
			var actions = req.body[paths.action].split('|');

			actions.forEach(function(action) {

				action = action.split(':');

				var method = action[0],
					ids = action[1];

				if (!(/^(delete|reset)$/.test(method)) || !ids) return;

				ids.split(',').forEach(function(id) {
					field.apply(item, method, id);
				});

			});
		}

		// Upload new files
		if (req.files) {
			
			var upFiles = req.files[paths.upload];
			if (upFiles) {
				if (!Array.isArray(upFiles)) {
					upFiles = [upFiles];
				}

				if (upFiles.length > 0) {
					upFiles = _.filter(upFiles, function(f) { return typeof f.name !== 'undefined' && f.name.length > 0; });
					
					if (upFiles.length > 0) {
						console.log('uploading files:');
						console.log(upFiles);
						return field.uploadFiles(item, upFiles, true, callback);
					}
				}
			}
		}

		return callback();
	};

};


/**
 * Immediately handles a standard form submission for the field (see `getRequestHandler()`)
 *
 * @api public
 */

s3files.prototype.handleRequest = function(item, req, paths, callback) {
	this.getRequestHandler(item, req, paths, callback)();
};


/*!
 * Export class
 */

exports = module.exports = s3files;
