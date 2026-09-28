
export const MORANDI_PALETTES = [
  { name: 'sage',        bg: '#E3EDCD', border: '#C5DCB2', text: '#2D4A22', accent: '#7A9A60' }, // 豆沙绿/护眼绿
  { name: 'mist_blue',   bg: '#DCE8F5', border: '#B8D2EC', text: '#1E3A5F', accent: '#4E7CA8' }, // 雾霾蓝
  { name: 'dusty_rose',  bg: '#F6E5E5', border: '#ECC8C8', text: '#5C2424', accent: '#A95C5C' }, // 烟粉玫瑰
  { name: 'warm_oat',    bg: '#F5EFE6', border: '#E8DCB8', text: '#4E3822', accent: '#9C7A4E' }, // 燕麦暖驼
  { name: 'lavender',    bg: '#EAE6F5', border: '#D3C9EC', text: '#3E2D68', accent: '#7A62A8' }, // 浅薰衣草
  { name: 'sea_salt',    bg: '#E2F0D9', border: '#C4E1B3', text: '#2B4A1D', accent: '#5C8C43' }, // 海盐薄荷
  { name: 'clay_orange', bg: '#FCECDD', border: '#F7D0B2', text: '#5D3114', accent: '#B2622F' }, // 浅黏土杏
  { name: 'slate_grey',  bg: '#EAEBED', border: '#CFD2D6', text: '#343A40', accent: '#6C757D' }, // 青石冷灰
  { name: 'olive_light', bg: '#EEF2E6', border: '#D5E0C2', text: '#394626', accent: '#738C4D' }, // 浅橄榄绿
  { name: 'lilac',       bg: '#F3E8EE', border: '#E3C8D7', text: '#502941', accent: '#96527C' }, // 浅丁香
  { name: 'teal_haze',   bg: '#E0F2F1', border: '#B2DFDB', text: '#004D40', accent: '#00796B' }, // 浅黛青
  { name: 'matcha',      bg: '#EDF1D6', border: '#D0DC9E', text: '#40513B', accent: '#609966' }  // 浅抹茶
];
export function getMorandiColor(courseName) {
  if (!courseName || typeof courseName !== 'string') {
    return MORANDI_PALETTES[0];
  }
  let hash = 0;
  for (let i = 0; i < courseName.length; i++) {
    hash = (hash << 5) - hash + courseName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % MORANDI_PALETTES.length;
  return MORANDI_PALETTES[index];
}
