const rateLimit = require("express-rate-limit");

const publicOrderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again after a minute."
  }
});

module.exports = {
  publicOrderLimiter
};