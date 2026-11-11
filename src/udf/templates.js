// Starting points for common filings, as editor JSON. Bracketed text is a
// placeholder to overwrite. `profile` = the lawyer's saved details.
import { defaultParaAttrs } from './codec.js';

const P = (content, attrs = {}) => ({ type: 'paragraph', attrs: { ...defaultParaAttrs(), ...attrs }, ...(content?.length ? { content } : {}) });
const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}) });
const B = (text) => t(text, 'bold');
const empty = () => P([]);
const J = { align: 'justify', lineSpacing: 0.5 };
const today = () => new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const label = (k, v) => P([B(`${k}\t: `), t(v)], { ...J, tabSet: '120.0:0:0', leftIndent: 0, firstLineIndent: 0 });

function signatureBlock(profile, role = 'Davacı Vekili') {
  return [
    empty(),
    P([t(today())], { align: 'right' }),
    P([B(role)], { align: 'right' }),
    P([t(profile?.name ? `Av. ${profile.name}` : 'Av. [Ad Soyad]')], { align: 'right' }),
    P([t('(e-imzalıdır)')], { align: 'right' }),
  ];
}

function header(court) {
  return [P([B(court)], { align: 'center' }), empty()];
}

export const TEMPLATES = [
  {
    id: 'blank',
    name: 'Boş belge',
    desc: 'Times New Roman 12, A4, UYAP varsayılan kenar boşlukları',
    build: () => [P([], { align: 'justify' })],
  },
  {
    id: 'dava',
    name: 'Dava dilekçesi',
    desc: 'HMK 119 unsurlarıyla hukuk davası dilekçesi',
    build: (profile) => [
      ...header('[İSTANBUL] NÖBETÇİ [ASLİYE HUKUK] MAHKEMESİ SAYIN HAKİMLİĞİ\'NE'),
      label('DAVACI', '[Ad Soyad / Unvan] (T.C. Kimlik No / VKN: [ ])'),
      label('', '[Adres]'),
      label('VEKİLİ', profile?.name ? `Av. ${profile.name}${profile.bar ? ` — ${profile.bar}` : ''}` : 'Av. [Ad Soyad] — [Baro, Sicil No]'),
      label('', profile?.address || '[Büro adresi]'),
      label('DAVALI', '[Ad Soyad / Unvan] — [Adres]'),
      label('DAVA DEĞERİ', '[ ] TL'),
      label('KONU', '[Davanın konusu ve talep sonucunun özeti]'),
      empty(),
      P([B('AÇIKLAMALAR')], J),
      empty(),
      P([t('[Olaylar sıra numarası altında açık ve kısa olarak anlatılır.]')], { ...J, list: { kind: 'number', type: 'NUMBER_TYPE_NUMBER_DOT', id: '1', level: 1 }, leftIndent: 25, firstLineIndent: -18 }),
      P([t('[…]')], { ...J, list: { kind: 'number', type: 'NUMBER_TYPE_NUMBER_DOT', id: '1', level: 1 }, leftIndent: 25, firstLineIndent: -18 }),
      empty(),
      P([B('HUKUKİ SEBEPLER\t: '), t('[HMK, TBK, TMK ve ilgili mevzuat]')], J),
      P([B('HUKUKİ DELİLLER\t: '), t('[Belgeler, tanık, bilirkişi, keşif, yemin ve her türlü yasal delil]')], J),
      empty(),
      P([B('SONUÇ VE İSTEM\t: '), t('Yukarıda açıklanan ve re\'sen gözetilecek nedenlerle; [talep]; yargılama giderleri ile vekâlet ücretinin davalı tarafa yükletilmesine karar verilmesini vekâleten saygılarımızla arz ve talep ederiz.')], J),
      ...signatureBlock(profile),
      empty(),
      P([B('EKLER\t:')], J),
      P([t('Vekâletname')], { ...J, list: { kind: 'number', type: 'NUMBER_TYPE_NUMBER_TRE', id: '2', level: 1 }, leftIndent: 25, firstLineIndent: -18 }),
    ],
  },
  {
    id: 'cevap',
    name: 'Cevap dilekçesi',
    desc: 'Esas numaralı dosyaya cevap / beyan',
    build: (profile) => [
      ...header('[İSTANBUL] [3]. [ASLİYE TİCARET] MAHKEMESİ SAYIN HAKİMLİĞİ\'NE'),
      label('DOSYA NO', '[2026/… Esas]'),
      empty(),
      label('DAVALI', '[Ad Soyad / Unvan]'),
      label('VEKİLİ', profile?.name ? `Av. ${profile.name}` : 'Av. [Ad Soyad]'),
      label('DAVACI', '[Ad Soyad / Unvan]'),
      label('KONU', 'Davaya karşı cevaplarımızın sunulmasından ibarettir.'),
      empty(),
      P([B('AÇIKLAMALAR')], J),
      empty(),
      P([B('I. USULE İLİŞKİN İTİRAZLARIMIZ')], J),
      P([t('[Görev, yetki, dava şartları, zamanaşımı…]')], { ...J, firstLineIndent: 35.4 }),
      empty(),
      P([B('II. ESASA İLİŞKİN CEVAPLARIMIZ')], J),
      P([t('[…]')], { ...J, firstLineIndent: 35.4 }),
      empty(),
      P([B('SONUÇ VE İSTEM\t: '), t('Açıklanan nedenlerle haksız ve hukuki dayanaktan yoksun davanın reddine, yargılama giderleri ile vekâlet ücretinin davacı tarafa yükletilmesine karar verilmesini vekâleten saygılarımızla arz ve talep ederiz.')], J),
      ...signatureBlock(profile, 'Davalı Vekili'),
    ],
  },
  {
    id: 'beyan',
    name: 'Beyan / talep dilekçesi',
    desc: 'Kısa beyan, süre uzatımı, ara karar talebi',
    build: (profile) => [
      ...header('[İSTANBUL] [3]. [ASLİYE TİCARET] MAHKEMESİ SAYIN HAKİMLİĞİ\'NE'),
      label('DOSYA NO', '[2026/… Esas]'),
      empty(),
      label('BEYANDA BULUNAN', '[Davacı / Davalı] [Ad Soyad / Unvan]'),
      label('VEKİLİ', profile?.name ? `Av. ${profile.name}` : 'Av. [Ad Soyad]'),
      label('KONU', '[Beyanlarımızın / talebimizin sunulmasından ibarettir.]'),
      empty(),
      P([B('AÇIKLAMALAR\t:')], J),
      P([t('[Beyan / talep]')], { ...J, firstLineIndent: 35.4 }),
      empty(),
      P([B('SONUÇ VE İSTEM\t: '), t('Yukarıda arz edilen nedenlerle [talebimiz doğrultusunda karar verilmesini] vekâleten saygılarımızla arz ve talep ederiz.')], J),
      ...signatureBlock(profile),
    ],
  },
];

/** Insertable blocks (Ekle → Hazır bloklar). */
export const BLOCKS = [
  { id: 'imza', name: 'Tarih ve imza bloğu', build: (profile) => signatureBlock(profile) },
  { id: 'vekil', name: 'Vekil bilgileri', build: (profile) => [label('VEKİLİ', profile?.name ? `Av. ${profile.name}${profile.bar ? ` — ${profile.bar}` : ''}` : 'Av. [Ad Soyad]'), label('', profile?.address || '[Büro adresi]')] },
  { id: 'sonuc', name: 'Sonuç ve istem', build: () => [P([B('SONUÇ VE İSTEM\t: '), t('Yukarıda açıklanan nedenlerle [talep] karar verilmesini vekâleten saygılarımızla arz ve talep ederiz.')], J)] },
  { id: 'ekler', name: 'Ekler listesi', build: () => [P([B('EKLER\t:')], J), P([t('Vekâletname')], { ...J, list: { kind: 'number', type: 'NUMBER_TYPE_NUMBER_TRE', id: '90', level: 1 }, leftIndent: 25, firstLineIndent: -18 })] },
  { id: 'deliller', name: 'Hukuki sebepler / deliller', build: () => [P([B('HUKUKİ SEBEPLER\t: '), t('[ ]')], J), P([B('HUKUKİ DELİLLER\t: '), t('[ ]')], J)] },
];
