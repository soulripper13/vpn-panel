/**
 * middleware/validate.js
 * Request body/query validator using Joi
 */

'use strict';

/**
 * Validate request body against a Joi schema
 * @param {import('joi').Schema} schema
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      const details = error.details.map((d) => d.message).join(', ');
      return res.status(400).json({
        success: false,
        message: `Validation error: ${details}`,
        data: null,
      });
    }
    req.body = value;
    next();
  };
}

module.exports = {
  validateBody,
};
