// ISO 3166-1 alpha-3 → alpha-2. MRZ uses alpha-3 (plus "D" for Germany);
// display names come from the browser via Intl.DisplayNames.
const MAP = `AFG AF,ALA AX,ALB AL,DZA DZ,ASM AS,AND AD,AGO AO,AIA AI,ATG AG,ARG AR,ARM AM,ABW AW,AUS AU,AUT AT,
AZE AZ,BHS BS,BHR BH,BGD BD,BRB BB,BLR BY,BEL BE,BLZ BZ,BEN BJ,BMU BM,BTN BT,BOL BO,BES BQ,BIH BA,BWA BW,BRA BR,
BRN BN,BGR BG,BFA BF,BDI BI,CPV CV,KHM KH,CMR CM,CAN CA,CYM KY,CAF CF,TCD TD,CHL CL,CHN CN,COL CO,COM KM,COG CG,
COD CD,CRI CR,CIV CI,HRV HR,CUB CU,CUW CW,CYP CY,CZE CZ,DNK DK,DJI DJ,DMA DM,DOM DO,ECU EC,EGY EG,SLV SV,GNQ GQ,
ERI ER,EST EE,SWZ SZ,ETH ET,FJI FJ,FIN FI,FRA FR,GUF GF,PYF PF,GAB GA,GMB GM,GEO GE,DEU DE,GHA GH,GIB GI,GRC GR,
GRL GL,GRD GD,GLP GP,GUM GU,GTM GT,GGY GG,GIN GN,GNB GW,GUY GY,HTI HT,VAT VA,HND HN,HKG HK,HUN HU,ISL IS,IND IN,
IDN ID,IRN IR,IRQ IQ,IRL IE,IMN IM,ISR IL,ITA IT,JAM JM,JPN JP,JEY JE,JOR JO,KAZ KZ,KEN KE,KIR KI,PRK KP,KOR KR,
KWT KW,KGZ KG,LAO LA,LVA LV,LBN LB,LSO LS,LBR LR,LBY LY,LIE LI,LTU LT,LUX LU,MAC MO,MDG MG,MWI MW,MYS MY,MDV MV,
MLI ML,MLT MT,MHL MH,MTQ MQ,MRT MR,MUS MU,MYT YT,MEX MX,FSM FM,MDA MD,MCO MC,MNG MN,MNE ME,MSR MS,MAR MA,MOZ MZ,
MMR MM,NAM NA,NRU NR,NPL NP,NLD NL,NCL NC,NZL NZ,NIC NI,NER NE,NGA NG,MKD MK,NOR NO,OMN OM,PAK PK,PLW PW,PSE PS,
PAN PA,PNG PG,PRY PY,PER PE,PHL PH,POL PL,PRT PT,PRI PR,QAT QA,REU RE,ROU RO,RUS RU,RWA RW,BLM BL,KNA KN,LCA LC,
MAF MF,SPM PM,VCT VC,WSM WS,SMR SM,STP ST,SAU SA,SEN SN,SRB RS,SYC SC,SLE SL,SGP SG,SXM SX,SVK SK,SVN SI,SLB SB,
SOM SO,ZAF ZA,SSD SS,ESP ES,LKA LK,SDN SD,SUR SR,SWE SE,CHE CH,SYR SY,TWN TW,TJK TJ,TZA TZ,THA TH,TLS TL,TGO TG,
TON TO,TTO TT,TUN TN,TUR TR,TKM TM,TCA TC,TUV TV,UGA UG,UKR UA,ARE AE,GBR GB,USA US,URY UY,UZB UZ,VUT VU,VEN VE,
VNM VN,VGB VG,VIR VI,WLF WF,YEM YE,ZMB ZM,ZWE ZW,RKS XK`

export const ISO3_TO_ISO2 = Object.fromEntries(
  MAP.split(',').map((p) => p.trim().split(' ')).filter((p) => p.length === 2),
)
ISO3_TO_ISO2.D = 'DE'

export function normalizeCountry(code) {
  if (!code) return ''
  const c = code.replace(/</g, '').toUpperCase()
  return c === 'D' ? 'DEU' : c
}

const cache = {}
export function countryOptions(lang) {
  if (cache[lang]) return cache[lang]
  const names = new Intl.DisplayNames([lang], { type: 'region' })
  cache[lang] = Object.entries(ISO3_TO_ISO2)
    .filter(([iso3]) => iso3 !== 'D')
    .map(([iso3, iso2]) => ({ value: iso3, label: names.of(iso2) || iso3 }))
    .sort((a, b) => a.label.localeCompare(b.label, lang))
  return cache[lang]
}

export function countryName(iso3, lang) {
  const iso2 = ISO3_TO_ISO2[normalizeCountry(iso3)]
  if (!iso2) return iso3 || ''
  return new Intl.DisplayNames([lang], { type: 'region' }).of(iso2)
}
