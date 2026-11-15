import assert from 'node:assert/strict';
import {createGmailSender} from './api/mail.js';
assert.equal(createGmailSender({}),undefined);
assert.equal(createGmailSender({GMAIL_SMTP_USER:'test@example.com',GMAIL_SMTP_APP_PASSWORD:'incorrect'}),undefined);
let config,mail,closed=false;
const send=createGmailSender({GMAIL_SMTP_USER:'test@example.com',GMAIL_SMTP_APP_PASSWORD:'abcd efgh ijkl mnop'},async()=>({createTransport:options=>{config=options;return {sendMail:async message=>{mail=message;return {messageId:message.messageId,accepted:[message.to]};},close:()=>{closed=true;}};}}));
const result=await send({to:'owner@example.com',subject:'Follow-up due',text:'Synthetic test',reminderId:'11111111-1111-1111-1111-111111111111'});
assert.equal(config.host,'smtp.gmail.com');assert.equal(config.port,465);assert.equal(config.secure,true);assert.equal(config.auth.pass,'abcdefghijklmnop');assert.deepEqual(mail.from,{name:'SoftSolutions',address:'test@example.com'});assert.equal(result.id,'<crm-follow-up-11111111-1111-1111-1111-111111111111@softsolutions.agency>');assert.ok(closed);
console.log('Gmail adapter passed: TLS transport, App Password validation, fixed sender, recipient, stable message ID, and connection cleanup. No email sent.');
