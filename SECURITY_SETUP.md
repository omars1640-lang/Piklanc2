# إعداد الأمان والنشر

## 1. إنشاء حساب المدير

1. أنشئ حسابًا عاديًا من الموقع وتحقق من بريده الإلكتروني.
2. افتح Firebase Console ثم Firestore Database ثم مجموعة `users`.
3. افتح مستند المستخدم المطلوب وأضف الحقل:

   - الاسم: `role`
   - النوع: `string`
   - القيمة: `admin`

   ولحساب المالك الرئيسي فقط أضف أيضاً:

   - الاسم: `adminAccessLevel`
   - النوع: `string`
   - القيمة: `super_admin`

4. تأكد أن قيمة `status` لهذا الحساب هي `active`.

لا تضف صلاحية `admin` من كود المتصفح أو نموذج التسجيل.

## 2. نشر قواعد Firebase

ثبّت Firebase CLI وسجّل الدخول، ثم شغّل الأوامر من مجلد المشروع:

```powershell
firebase login
firebase use piklance-c2651
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
firebase deploy --only functions,firestore:rules,firestore:indexes,storage,hosting
```

رفع الملفات إلى GitHub Pages لا ينشر قواعد Firebase تلقائيًا.

## 3. التحقق قبل الإطلاق

شغّل الفحص الأمني المحلي قبل كل نشر:

```powershell
node scripts/security-audit.mjs
```

## 4. تفعيل Firebase App Check

1. من Firebase Console افتح **App Check** وسجّل تطبيق الويب باستخدام reCAPTCHA Enterprise.
2. انسخ مفتاح الموقع العام إلى `appCheckSiteKey` في `js/firebase.js`.
3. اختبر المنصة أولاً مع بقاء المراقبة بدون فرض الحماية.
4. أنشئ محلياً الملف `functions/.env.piklance-c2651` (وهو مستثنى من Git) وضع فيه:

```dotenv
ENFORCE_APP_CHECK=true
```

5. أعد نشر Hosting وFunctions، ثم تأكد من وصول طلبات صحيحة في شاشة App Check قبل اعتماد التفعيل نهائياً.

## 5. تنظيف محددات الإساءة

فعّل Firestore TTL للحقل `expiresAt` في مجموعة `securityRateLimits` حتى تُحذف سجلات تحديد المعدل المنتهية تلقائياً.

## 6. قائمة التحقق التشغيلية

- فعّل Email/Password من Firebase Authentication.
- تأكد أن Firestore وStorage يستخدمان القواعد الموجودة في هذا المشروع.
- اختبر حساب عميل موثق، حساب مستقل معلق، وحساب مدير.
- اختبر الشحن والسحب بحوالات صغيرة قبل استقبال أموال حقيقية.
- لا تحفظ App Password الخاص بالبريد داخل ملفات المشروع أو GitHub.
- راجع سجل `adminAuditLogs` وسجل `walletLedger` عند التحقيق في أي عملية مالية.
- لا تجعل `ENFORCE_APP_CHECK=true` قبل إضافة مفتاح App Check إلى الواجهة، لأن ذلك سيمنع جميع Callable Functions.
- جميع استيرادات Firebase في المتصفح مثبتة على إصدار واحد. عند ترقيته لاحقاً حدّث كل الاستيرادات معاً وشغّل `node scripts/security-audit.mjs`.
- سياسة CSP الحالية انتقالية وتسمح بالسكريبتات المضمنة. الخطوة اللاحقة للتشديد الكامل هي نقل السكربتات المضمنة إلى ملفات خارجية ثم حذف `'unsafe-inline'` من `script-src`.
