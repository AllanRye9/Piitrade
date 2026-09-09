const _jkccp8cap0 = require('../dictionary/flash-deals.json');
const _1u4zej91c9n = require('../dictionary/home-page.json');
const _51ts8uoiqg = require('../dictionary/locale-switcher.json');
const _h6frltuf0e = require('../dictionary/mobileBottomNav.json');

const dictionaries = {
  "flash-deals": _jkccp8cap0,
  "home-page": _1u4zej91c9n,
  "locale-switcher": _51ts8uoiqg,
  "mobileBottomNav": _h6frltuf0e
};
const getDictionaries = () => dictionaries;

module.exports.getDictionaries = getDictionaries;
module.exports = dictionaries;
