const _16dayydes14 = require('../dictionary/flash-deals.json');
const _22w0vndcqj6 = require('../dictionary/home-page.json');
const _218gq8wigkq = require('../dictionary/locale-switcher.json');
const _29kaz7ym1gw = require('../dictionary/mobileBottomNav.json');

const dictionaries = {
  "flash-deals": _16dayydes14,
  "home-page": _22w0vndcqj6,
  "locale-switcher": _218gq8wigkq,
  "mobileBottomNav": _29kaz7ym1gw
};
const getDictionaries = () => dictionaries;

module.exports.getDictionaries = getDictionaries;
module.exports = dictionaries;
