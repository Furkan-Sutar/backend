export function calculateFee(courseFee:number,discountAmount=0,amountPaid=0){
  if(!Number.isFinite(courseFee)||!Number.isFinite(discountAmount)||!Number.isFinite(amountPaid)||courseFee<0||discountAmount<0||discountAmount>courseFee||amountPaid<0||amountPaid>courseFee-discountAmount)throw new RangeError('Fee values must be finite and within the course fee');
  const finalFee=Math.round((courseFee-discountAmount)*100)/100;
  return {courseFee,discountAmount,finalFee,amountPaid,amountDue:Math.round((finalFee-amountPaid)*100)/100};
}
export function calculateDiscount(courseFee:number,kind:'FIXED'|'PERCENT',value:number){if(!Number.isFinite(value)||value<0||(kind==='PERCENT'&&value>100))throw new RangeError('Discount value is invalid');return Math.round((kind==='FIXED'?value:courseFee*value/100)*100)/100;}
export function assertPaymentWithinDue(amount:number,amountDue:number,installmentDue=amountDue){if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)>Math.round(Math.min(amountDue,installmentDue)*100))throw new RangeError('Payment exceeds the remaining fee due');}
export function calculateInstallmentTotal(amounts:number[],finalFee:number){if(!amounts.length||amounts.some(x=>!Number.isFinite(x)||x<=0)||Math.round(amounts.reduce((a,b)=>a+b,0)*100)!==Math.round(finalFee*100))throw new RangeError('Installments must add up exactly to finalFee');return true;}
