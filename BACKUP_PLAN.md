# PikLance Backup Plan

## Code Backup

Latest local code backup location:

`C:\Users\ASUS\Documents\PikLance-Backups`

Recommended frequency:

- Before every major deployment.
- At least once per week during active development.

## Firestore Backup

Recommended production method is a Firestore managed export to a Google Cloud Storage bucket.

Run from Google Cloud Shell or any machine with Google Cloud SDK:

```bash
gcloud config set project piklance-c2651
gcloud firestore export gs://piklance-c2651-backups/firestore/$(date +%Y-%m-%d_%H-%M-%S)
```

If the bucket does not exist yet:

```bash
gcloud storage buckets create gs://piklance-c2651-backups --location=eur4
```

Restore example:

```bash
gcloud firestore import gs://piklance-c2651-backups/firestore/BACKUP_FOLDER
```

## Storage Backup

Firebase Storage files can be mirrored to the same backup bucket:

```bash
gcloud storage cp -r gs://piklance-c2651.firebasestorage.app/** gs://piklance-c2651-backups/storage/$(date +%Y-%m-%d_%H-%M-%S)/
```

If the source bucket name differs in Google Cloud Console, use the bucket shown under Firebase Storage.

## Minimum Backup Checklist

- Firestore export completed successfully.
- Storage copy completed successfully.
- Current repo code zip exists locally.
- Verify at least one recent backup can be listed from Cloud Storage.
- Keep at least 7 daily backups and 4 weekly backups before deleting older ones.
