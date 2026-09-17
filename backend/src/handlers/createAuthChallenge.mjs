import crypto from 'node:crypto';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { toE164 } from '../phone.mjs';

const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

// This exact wording is what must be registered as the DLT Content Template
// (TRAI/Indian telecom regulator) — the {#var#} placeholder becomes the code
// below. Any drift between this string and the approved template text gets
// the message silently blocked by Indian carriers, DLT-registered or not.
// See DOCUMENTATION.md's "Phone + OTP login" section for the registration
// process and where SNS_DLT_ENTITY_ID/SNS_DLT_TEMPLATE_ID/SNS_SENDER_ID
// (below) come from.
function buildOtpMessage(code) {
  return `Your OneLingo verification code is ${code}. Valid for 5 minutes. Do not share this code with anyone.`;
}

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
 * Once registered, AWS also needs your Entity ID + Template ID (via an AWS
 * Support case — this isn't self-service) before it will actually attach
 * them to outbound SMS; set SNS_DLT_ENTITY_ID/SNS_DLT_TEMPLATE_ID/
 * SNS_SENDER_ID below once that's done. All three are optional and additive:
 * unset (the default), this sends exactly what it always has, so nothing
 * changes for non-Indian numbers or before registration is complete.
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

    const messageAttributes = {
      'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
    };
    // DLT Entity/Template ID — the attribute names AWS documents for its
    // India-SMS/DLT support at the time this was written; worth a quick
    // cross-check against AWS's current SNS India-SMS docs before relying
    // on this in production, since these are AWS's own string constants,
    // not something this codebase controls.
    if (process.env.SNS_DLT_ENTITY_ID) {
      messageAttributes['AWS.MM.SMS.EntityId'] = { DataType: 'String', StringValue: process.env.SNS_DLT_ENTITY_ID };
    }
    if (process.env.SNS_DLT_TEMPLATE_ID) {
      messageAttributes['AWS.MM.SMS.TemplateId'] = { DataType: 'String', StringValue: process.env.SNS_DLT_TEMPLATE_ID };
    }
    // Registered DLT header (e.g. "ONELNG") — without this, AWS sends from a
    // generic/unregistered sender, which Indian carriers block regardless of
    // Entity/Template ID being correct.
    if (process.env.SNS_SENDER_ID) {
      messageAttributes['AWS.SNS.SMS.SenderID'] = { DataType: 'String', StringValue: process.env.SNS_SENDER_ID };
    }

    await sns.send(new PublishCommand({
      PhoneNumber: phone,
      Message: buildOtpMessage(code),
      MessageAttributes: messageAttributes,
    }));
  }

  event.response.publicChallengeParameters = { phone };
  event.response.privateChallengeParameters = { code };
  event.response.challengeMetadata = `CODE-${code}`;

  return event;
}
