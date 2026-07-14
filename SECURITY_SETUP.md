# إعداد الأمان والنشر

## 1. إنشاء حساب المدير

1. أنشئ حسابًا عاديًا من الموقع وتحقق من بريده الإلكتروني.
2. افتح Firebase Console ثم Firestore Database ثم مجموعة `users`.
3. افتح مستند المستخدم المطلوب وأضف الحقل:

   - الاسم: `role`
   - النوع: `string`
   - القيمة: `admin`

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

- فعّل Email/Password من Firebase Authentication.
- تأكد أن Firestore وStorage يستخدمان القواعد الموجودة في هذا المشروع.
- اختبر حساب عميل موثق، حساب مستقل معلق، وحساب مدير.
- اختبر الشحن والسحب بحوالات صغيرة قبل استقبال أموال حقيقية.
- لا تحفظ App Password الخاص بالبريد داخل ملفات المشروع أو GitHub.
- راجع سجل `adminAuditLogs` وسجل `walletLedger` عند التحقيق في أي عملية مالية.
