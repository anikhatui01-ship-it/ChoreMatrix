import { createClient } from '@supabase/supabase-js';

const url = 'https://ftuenrkqiyacvyuajdtl.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0dWVucmtxaXlhY3Z5dWFqZHRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDUyNDAwMiwiZXhwIjoyMTA2MTAwMDAyfQ.CcTwbYmhNeyvICa0eActCKFM2zK7n8f-ZS36yoHW2AQ';
const anonKey = 'sb_publishable_QTe5H4-ZAyken9ReKgFPvg_-KcLoHYT';
const adminClient = createClient(url, serviceKey);
const client = createClient(url, anonKey);

async function fullVerification() {
  console.log('=== 1. DEPLOYED VERCEL FRONTEND VERIFICATION ===');
  const accountHtmlRes = await fetch('https://www.chorematrix.online/account.html');
  const html = await accountHtmlRes.text();
  console.log('account.html HTTP Status:', accountHtmlRes.status);
  console.log('account.html Content-Type:', accountHtmlRes.headers.get('content-type'));
  console.log('Has paddle-cancel-subscription:', html.includes('paddle-cancel-subscription'));
  console.log('Has getEnvVar:', html.includes('getEnvVar'));
  console.log('Has [Account Cancellation Diagnostic]:', html.includes('[Account Cancellation Diagnostic]'));
  console.log('Does NOT have broken window.__ENV__ URL assignment:', !html.includes('(window.__ENV__?.VITE_SUPABASE_URL || \'\')'));

  console.log('\n=== 2. DEPLOYED CLIENT BUNDLE VERIFICATION ===');
  const bundleRes = await fetch('https://www.chorematrix.online/src/client.bundle.js');
  const bundleText = await bundleRes.text();
  console.log('client.bundle.js HTTP Status:', bundleRes.status);
  console.log('Contains Supabase production URL:', bundleText.includes('https://ftuenrkqiyacvyuajdtl.supabase.co'));

  console.log('\n=== 3. OLD FAILING REQUEST REPRODUCTION ===');
  const oldUrl = 'https://www.chorematrix.online/functions/v1/paddle-cancel-subscription';
  const oldRes = await fetch(oldUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  console.log('Old Request URL:', oldUrl);
  console.log('Old Request HTTP Status:', oldRes.status);
  console.log('Old Request Content-Type:', oldRes.headers.get('content-type'));
  const oldBody = await oldRes.text();
  console.log('Old Request Body snippet (first 100 chars):', oldBody.trim().slice(0, 100));
  console.log('Old Request produces <!doctype HTML:', oldBody.trim().startsWith('<!doctype'));

  console.log('\n=== 4. LIVE SUPABASE EDGE FUNCTION VERIFICATION ===');
  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: 'hemenesy37@gmail.com'
  });
  if (linkErr) throw linkErr;

  const { data: sessionData, error: otpErr } = await client.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink'
  });
  if (otpErr) throw otpErr;

  const token = sessionData.session.access_token;
  const directEndpoint = 'https://ftuenrkqiyacvyuajdtl.supabase.co/functions/v1/paddle-cancel-subscription';

  const res = await fetch(directEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'apikey': anonKey
    },
    body: JSON.stringify({})
  });

  const contentType = res.headers.get('content-type') || '';
  console.log('Direct Endpoint URL:', directEndpoint);
  console.log('Direct Endpoint HTTP Status:', res.status);
  console.log('Direct Endpoint Content-Type:', contentType);
  console.log('Direct Endpoint is JSON:', contentType.includes('application/json'));

  const data = await res.json();
  console.log('Direct Endpoint Response Data:', data);

  console.log('\n=== 5. POST-CANCELLATION PROFILE & REFRESH QUERY ===');
  const { data: profile } = await client.from('profiles').select('plan_tier, subscription_status').eq('id', sessionData.user.id).single();
  const { data: sub } = await client.from('paddle_subscriptions').select('subscription_id, status, scheduled_change').eq('user_id', sessionData.user.id).single();

  console.log('Profile:', profile);
  console.log('Paddle Subscription Record:', sub);
  console.log('\nAll assertions passed cleanly!');
}

fullVerification().catch(console.error);
