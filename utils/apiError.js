class ApiError extends Error {
    constructor(message, statusCode) {
        if (typeof message === 'number' && typeof statusCode === 'string') {
            super(statusCode);
            this.statusCode = message;
        } else {
            super(message || "An error occurred");
            this.statusCode = statusCode || 500;
        }
        this.status = `${this.statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}
module.exports = ApiError;