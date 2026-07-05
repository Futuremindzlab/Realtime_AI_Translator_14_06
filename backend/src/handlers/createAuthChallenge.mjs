import crypto from 'node:crypto';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { toE164 } from '../phone.mjs';

const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Cognito "Create Auth Challenge" trigger for the phone + OTP custom auth flow.
 *
 * Generates a 6-digit code, texts it via SNS, and stores it as a
 * privateChallengeParameter for VerifyAuthChallengeResponse to check.
 *
 * User provisioning happens BEFORE this ever runs (see phoneAuth.mjs's
 * requestPhoneOtp, called by the client before initiateAuth) — this trigger
 * assumes the user already exists and never sees request.userNotFound=true.
 *
 * NOTE: Indian (+91) numbers additionally require DLT template registration
 * with Indian telecom regulators before SNS SMS reliably delivers — see
 * DOCUMENTATION.md. sns:Publish succeeding here does not guarantee delivery.
 */
export async function handler(event) {
  const phone = toE164(event.request.userAttributes.phone_number);

  // Only generate/send a new code on the first challenge of this session;
  // resend the same code on a re-prompt so the user isn't sent two different codes.
  const session = event.request.session || [];
  const priorChallenge = session.length > 0 ? session[session.length - 1] : null;

  let code;
  if (priorChallenge?.challengeMetadata?.startsWith('CODE-')) {
    code = priorChallenge.challengeMetadata.slice('CODE-'.length);
  } else {
    code = crypto.randomInt(100000, 1000000).toString();
    await sns.send(new PublishCommand({
      PhoneNumber: phone,
      Message: `Your Realtime AI Translator verification code is ${code}. It expires in 5 minutes.`,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }));
  }

  event.response.publicChallengeParameters = { phone };
  event.response.privateChallengeParameters = { code };
  event.response.challengeMetadata = `CODE-${code}`;

  return event;
}
