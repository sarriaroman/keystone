var _ = require('underscore'),
	keystone = require('../../'),
	Types = require('../fieldTypes');

/**
 * List track option
 *
 * When enabled, it tracks when a document are created/updated, 
 * as well as the user who created/updated it.
 */

module.exports = function track() {
	
	var list = this,
		options = list.get('track'),
		userModel = keystone.get('user model'),
		defaultOptions = { 
			createdAt: false, 
			createdBy: false,
			updatedAt: false,
			updatedBy: false
		},
		fields = {};
	
	// ensure track is a boolean or an object
	if (!_.isBoolean(options) && !_.isObject(options) ) {
		throw new Error('Invalid List "track" option for ' + list.key + '\n' +
			'"track" must be a boolean or an object.\n\n' +
			'See http://keystonejs.com/docs/database/#lists-options for more information.');				
	}

	if (_.isBoolean(options)) {
		// shorthand: { track: true } sets all tracked fields to true
		if (options) {
			options = { 
				createdAt: true, 
				createdBy: true,
				updatedAt: true,
				updatedBy: true
			};
		} else {
			// otherwise user doesn't want tracking
			return;
		}
	}

	// if all track fields are set to false, then user doesn't want to track anything
	if (!options.createdAt && !options.createdBy && !options.updatedAt && !options.updatedBy) {
		return;
	}

	// merge user options with default options
	options = _.extend({}, defaultOptions, options);

	// validate option fields
	_.each(options, function(value, key) {
		
		var fieldName;
		
		// make sure the key isn't already defined as a field
		if (_.has(list.fields, key)) {
			throw new Error('Invalid List "track" option for ' + list.key + '\n' +
				'"' + key + '" is already defined in the Schema.');
		}

		// make sure it's a valid track option field
		if (_.has(defaultOptions, key)) {
			
			// make sure the option field value is either a boolean or a string
			if (!_.isBoolean(value) && !_.isString(value)) {
				throw new Error('Invalid List "track" option for ' + list.key + '\n' +
					'"' + key + '" must be a boolean or a string.\n\n' +
					'See http://keystonejs.com/docs/database/#lists-options for more information.');
			}

			if (value) {
				// determine 
				fieldName = value === true ? key : value;
				options[key] = fieldName;
				list.map(key, fieldName);

				switch(key) {
					case 'createdAt':
					case 'updatedAt':
						fields[fieldName] = { type: Date, hidden: true, index: true };
					break;

					case 'createdBy':
					case 'updatedBy':
						fields[fieldName] = { type: Types.Relationship, ref: userModel, hidden: true, index: true };
					break;
				}
			}
		} else {
			throw new Error('Invalid List "track" option for ' + list.key + '\n' +
				'valid field options are "createdAt", "createdBy", "updatedAt", an "updatedBy".\n\n' +
				'See http://keystonejs.com/docs/database/#lists-options for more information.');				
		}

	});

	// add track fields to schema
	list.add(fields);
	
	list.tracking = options;

	// add the pre-save schema plugin
	list.schema.pre('save', function (next) {
		
		var now = new Date();

		// set createdAt/createdBy on new docs
		if (this.isNew) {
			if (options.createdAt && !this.get(options.createdAt)) {
				this.set(options.createdAt, now);
			}
			if (options.createdBy && this._req_user && !this.get(options.createdBy)) {
				this.set(options.createdBy, this._req_user._id);
			}
		}

		// set updatedAt/updatedBy when doc is modified
		if (this.isNew || this.isModified()) {
			if (options.updatedAt) {
				this.set(options.updatedAt, now);
			}
			if (options.updatedBy && this._req_user) {
				this.set(options.updatedBy, this._req_user._id);
			}
		}

		next();
		
	});

};