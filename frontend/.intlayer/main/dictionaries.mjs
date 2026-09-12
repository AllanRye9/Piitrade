import _16dayydes14 from '../dictionary/flash-deals.json' with { type: 'json' };
import _22w0vndcqj6 from '../dictionary/home-page.json' with { type: 'json' };
import _218gq8wigkq from '../dictionary/locale-switcher.json' with { type: 'json' };
import _29kaz7ym1gw from '../dictionary/mobileBottomNav.json' with { type: 'json' };

const dictionaries = {
  "flash-deals": _16dayydes14,
  "home-page": _22w0vndcqj6,
  "locale-switcher": _218gq8wigkq,
  "mobileBottomNav": _29kaz7ym1gw
};
const getDictionaries = () => dictionaries;

export { getDictionaries };
export default dictionaries;
