// Gmail stays in the Node adapter; no SMTP credentials enter browser code.
export function createGmailSender(env,loadMailer=()=>import('nodemailer')) {
  if(!env.GMAIL_SMTP_USER||!env.GMAIL_SMTP_APP_PASSWORD)return undefined;
  const user=env.GMAIL_SMTP_USER.trim();
  const password=env.GMAIL_SMTP_APP_PASSWORD.replace(/\s/g,'');
  if(!/^\S+@\S+\.\S+$/.test(user)||/[\r\n]/.test(user)||! /^[a-zA-Z0-9]{16}$/.test(password))return undefined;
  return async message=>{
    const imported=await loadMailer(),mailer=imported.default||imported;
    const transport=mailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass:password},connectionTimeout:5000,greetingTimeout:5000,socketTimeout:8000});
    try{
      const result=await transport.sendMail({from:{name:'SoftSolutions',address:user},to:message.to,subject:message.subject,text:message.text,messageId:'<crm-follow-up-'+message.reminderId+'@softsolutions.agency>'});
      if(!result.messageId||!result.accepted?.some(address=>String(address).toLowerCase()===message.to.toLowerCase()))throw Error('Email not accepted');
      return {id:result.messageId};
    }finally{transport.close?.();}
  };
}
