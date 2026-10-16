// Texts of the extension itself (hover labels, messages) in the twelve backend
// languages of camindo CMS. The words follow the backend snippets (Key, Comparison
// operator, Default …) - the command descriptions come from data/commands.{lang}.json.
'use strict';

const TEXTS = {
    de_DE: { mandatory: 'Pflicht', keys: 'Schlüssel', operator: 'Vergleichsoperator erlaubt', value: 'Wert', default: 'Standard: {0}', oneOf: 'mindestens einer von', loaded: '{0} Befehle geladen.', unreadable: 'Befehlsdefinitionen nicht lesbar ({0}): {1}' },
    en_US: { mandatory: 'required', keys: 'Keys', operator: 'comparison operator allowed', value: 'Value', default: 'Default: {0}', oneOf: 'at least one of', loaded: '{0} commands loaded.', unreadable: 'Cannot read the command definitions ({0}): {1}' },
    ar_SA: { mandatory: 'إلزامي', keys: 'المفاتيح', operator: 'يُسمح بعامل المقارنة', value: 'القيمة', default: 'الافتراضي: {0}', oneOf: 'واحد على الأقل من', loaded: 'تم تحميل {0} أمرًا.', unreadable: 'تعذّرت قراءة تعريفات الأوامر ({0}): {1}' },
    bn_BD: { mandatory: 'আবশ্যক', keys: 'কী', operator: 'তুলনা অপারেটর অনুমোদিত', value: 'মান', default: 'ডিফল্ট: {0}', oneOf: 'অন্তত একটি', loaded: '{0}টি কমান্ড লোড হয়েছে।', unreadable: 'কমান্ড সংজ্ঞা পড়া যায়নি ({0}): {1}' },
    es_ES: { mandatory: 'obligatorio', keys: 'Claves', operator: 'se admite operador de comparación', value: 'Valor', default: 'Predeterminado: {0}', oneOf: 'al menos uno de', loaded: '{0} comandos cargados.', unreadable: 'No se pueden leer las definiciones de comandos ({0}): {1}' },
    fr_FR: { mandatory: 'obligatoire', keys: 'Clés', operator: 'opérateur de comparaison autorisé', value: 'Valeur', default: 'Par défaut : {0}', oneOf: 'au moins un parmi', loaded: '{0} commandes chargées.', unreadable: 'Impossible de lire les définitions de commandes ({0}) : {1}' },
    hi_IN: { mandatory: 'आवश्यक', keys: 'कुंजियाँ', operator: 'तुलना ऑपरेटर की अनुमति है', value: 'मान', default: 'डिफ़ॉल्ट: {0}', oneOf: 'इनमें से कम से कम एक', loaded: '{0} कमांड लोड किए गए।', unreadable: 'कमांड परिभाषाएँ पढ़ी नहीं जा सकीं ({0}): {1}' },
    ja_JP: { mandatory: '必須', keys: 'キー', operator: '比較演算子を使用可', value: '値', default: '既定値: {0}', oneOf: '次のいずれか1つ以上', loaded: '{0} 個のコマンドを読み込みました。', unreadable: 'コマンド定義を読み込めません（{0}）: {1}' },
    ko_KR: { mandatory: '필수', keys: '키', operator: '비교 연산자 사용 가능', value: '값', default: '기본값: {0}', oneOf: '다음 중 하나 이상', loaded: '명령 {0}개를 불러왔습니다.', unreadable: '명령 정의를 읽을 수 없습니다({0}): {1}' },
    pt_BR: { mandatory: 'obrigatório', keys: 'Chaves', operator: 'operador de comparação permitido', value: 'Valor', default: 'Padrão: {0}', oneOf: 'pelo menos um de', loaded: '{0} comandos carregados.', unreadable: 'Não é possível ler as definições de comandos ({0}): {1}' },
    ur_PK: { mandatory: 'لازمی', keys: 'کلیدیں', operator: 'موازنہ آپریٹر کی اجازت ہے', value: 'قدر', default: 'طے شدہ: {0}', oneOf: 'کم از کم ایک', loaded: '{0} کمانڈز لوڈ ہو گئیں۔', unreadable: 'کمانڈ کی تعریفیں پڑھی نہیں جا سکیں ({0}): {1}' },
    zh_CN: { mandatory: '必填', keys: '键', operator: '允许使用比较运算符', value: '值', default: '默认值：{0}', oneOf: '至少以下之一', loaded: '已加载 {0} 个命令。', unreadable: '无法读取命令定义（{0}）：{1}' },
};

const LANGUAGES = Object.keys(TEXTS);

// VS Code display language (vscode.env.language: "de", "pt-br", "zh-cn" …) -> backend language
const BY_PREFIX = {
    de: 'de_DE', en: 'en_US', ar: 'ar_SA', bn: 'bn_BD', es: 'es_ES', fr: 'fr_FR',
    hi: 'hi_IN', ja: 'ja_JP', ko: 'ko_KR', pt: 'pt_BR', ur: 'ur_PK', zh: 'zh_CN',
};

/**
 * Backend language for the setting camindo.language ('' = like VS Code).
 * @param {string} setting
 * @param {string} displayLanguage  vscode.env.language
 */
function resolveLanguage(setting, displayLanguage) {
    if (LANGUAGES.includes(setting)) return setting;
    return BY_PREFIX[String(displayLanguage || '').toLowerCase().split('-')[0]] || 'en_US';
}

/** Text with {0}, {1} … replaced */
function t(lang, key, ...args) {
    const text = (TEXTS[lang] || TEXTS.en_US)[key] || TEXTS.en_US[key] || key;
    return text.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m));
}

module.exports = { TEXTS, LANGUAGES, resolveLanguage, t };
