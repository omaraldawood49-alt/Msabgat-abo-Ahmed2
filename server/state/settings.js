'use strict';

// إعدادات عامة على مستوى الخادم (يشترك فيها كل الغرف)
const settings = {
  baseUrl: process.env.BASE_URL || null, // تجاوز يدوي للرابط الأساسي (لتوليد QR)
};

module.exports = settings;
