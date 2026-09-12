const _4wkfk0zg6f = require('../dictionary/flash-deals.json');
const _1fzi8m5hyvt = require('../dictionary/home-page.json');
const _13tfss83q2r = require('../dictionary/locale-switcher.json');
const _h7y25t1u9z = require('../dictionary/mobileBottomNav.json');

const dictionaries = {
  "flash-deals": _4wkfk0zg6f,
  "home-page": _1fzi8m5hyvt,
  "locale-switcher": _13tfss83q2r,
  "mobileBottomNav": _h7y25t1u9z
};
const getDictionaries = () => dictionaries;

module.exports.getDictionaries = getDictionaries;
module.exports = dictionaries;
