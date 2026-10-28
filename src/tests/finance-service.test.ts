import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  feeFind:vi.fn(),studentFind:vi.fn(),admissionFind:vi.fn(),accountFind:vi.fn(),installmentFind:vi.fn(),paymentFind:vi.fn(),paymentCreate:vi.fn(),receiptCreate:vi.fn(),audit:vi.fn(),transaction:vi.fn(),paymentExists:vi.fn(),refundExists:vi.fn(),receiptUpdate:vi.fn()
}));
vi.mock('../models/fee-plan.model.js',()=>({FeePlanModel:{findOne:mocks.feeFind}}));
vi.mock('../models/student.model.js',()=>({StudentModel:{findOne:mocks.studentFind}}));
vi.mock('../models/admission.model.js',()=>({AdmissionModel:{findOne:mocks.admissionFind}}));
vi.mock('../models/financial-account.model.js',()=>({FinancialAccountModel:{findOne:mocks.accountFind}}));
vi.mock('../models/fee-installment.model.js',()=>({FeeInstallmentModel:{findOne:mocks.installmentFind}}));
vi.mock('../models/payment.model.js',()=>({PaymentModel:{findOne:mocks.paymentFind,create:mocks.paymentCreate,exists:mocks.paymentExists}}));
vi.mock('../models/receipt.model.js',()=>({ReceiptModel:{create:mocks.receiptCreate,updateOne:mocks.receiptUpdate}}));
vi.mock('../models/refund.model.js',()=>({RefundModel:{exists:mocks.refundExists}}));
vi.mock('../models/discount.model.js',()=>({DiscountModel:{}}));
vi.mock('../models/course.model.js',()=>({CourseModel:{}}));
vi.mock('../models/payment-method.model.js',()=>({PaymentMethodModel:{}}));
vi.mock('../services/audit.service.js',()=>({AuditService:{record:mocks.audit}}));
vi.mock('../utils/transaction.js',()=>({inTransaction:mocks.transaction}));
import {financeService} from '../services/finance.service.js';

const auth={objectId:'64b000000000000000000001',userId:'SN-USR-2026-00001',instituteId:'64b000000000000000000002',instituteBusinessId:'SN-INS-2026-00001',name:'Accountant',role:'ACCOUNTANT' as const,authVersion:0};
const plan={_id:'64b000000000000000000010',feePlanId:'SN-FPL-2026-00001',studentId:'64b000000000000000000011',admissionId:'64b000000000000000000012',courseId:'64b000000000000000000013',instituteId:auth.instituteId,courseFee:100,discountAmount:0,finalFee:100,amountPaid:0,amountDue:100,status:'ACTIVE',toObject:()=>({amountPaid:0,amountDue:100}),save:vi.fn()};
const student={_id:plan.studentId};const admission={_id:plan.admissionId};const account={_id:'64b000000000000000000014',type:'CASH'};
const request={correlationId:'finance-test',ip:'127.0.0.1',header:()=>undefined} as never;
const input={feePlanId:String(plan._id),amount:60,paymentMethod:'CASH',financialAccountId:String(account._id)};
const chain=(value:unknown)=>({session:vi.fn().mockResolvedValue(value)});

beforeEach(()=>{
 vi.clearAllMocks();mocks.transaction.mockImplementation((work)=>(work({})));mocks.audit.mockResolvedValue({});
 mocks.feeFind.mockReturnValue(chain(plan));mocks.studentFind.mockReturnValue(chain(student));mocks.admissionFind.mockReturnValue(chain(admission));mocks.accountFind.mockReturnValue(chain(account));mocks.installmentFind.mockReturnValue(chain(null));
 mocks.paymentFind.mockReturnValue(Promise.resolve(null));
 mocks.paymentExists.mockReturnValue({session:vi.fn().mockResolvedValue(false)});mocks.refundExists.mockReturnValue({session:vi.fn().mockResolvedValue(false)});mocks.receiptUpdate.mockResolvedValue({modifiedCount:1});
 mocks.paymentCreate.mockResolvedValue([{_id:'64b000000000000000000020',paymentId:'SN-PAY-2026-00001',amount:60}]);mocks.receiptCreate.mockResolvedValue([{_id:'64b000000000000000000021',receiptId:'SN-REC-2026-00001',amount:60}]);plan.save.mockResolvedValue(plan);
});

describe('finance payment service',()=>{
 it('posts payment, updates calculated balance, issues receipt, and audits in the transaction',async()=>{
  const result=await financeService.createPayment(auth,request,input);
  expect(result.payment.paymentId).toBe('SN-PAY-2026-00001');expect(result.receipt.receiptId).toBe('SN-REC-2026-00001');
  expect(plan.amountPaid).toBe(60);expect(plan.amountDue).toBe(40);expect(plan.status).toBe('ACTIVE');
  expect(mocks.paymentCreate).toHaveBeenCalledWith([expect.objectContaining({amount:60,authorizedBy:auth.objectId,transactionType:'PAYMENT'})],{session:{}});
  expect(mocks.receiptCreate).toHaveBeenCalledOnce();expect(mocks.audit).toHaveBeenCalledTimes(2);
 });
 it('rejects overpayment before writing any payment or receipt',async()=>{
  await expect(financeService.createPayment(auth,request,{...input,amount:100.01})).rejects.toMatchObject({statusCode:409,code:'OVERPAYMENT'});
  expect(mocks.paymentCreate).not.toHaveBeenCalled();expect(mocks.receiptCreate).not.toHaveBeenCalled();
 });
 it('does not let a student post payments even with a valid plan reference',async()=>{
  await expect(financeService.createPayment({...auth,role:'STUDENT'},request,input)).rejects.toMatchObject({statusCode:403,code:'PERMISSION_FORBIDDEN'});
  expect(mocks.transaction).not.toHaveBeenCalled();
 });
 it('reverses a posted payment with a compensating record and restores the fee balance',async()=>{
  const original={_id:'64b000000000000000000022',paymentId:'SN-PAY-2026-00002',studentId:student._id,admissionId:admission._id,feePlanId:plan._id,amount:60,paymentMethod:'CASH',financialAccountId:account._id};
  plan.amountPaid=60;plan.amountDue=40;
  mocks.paymentFind.mockReturnValue({session:vi.fn().mockResolvedValue(original)});
  mocks.paymentCreate.mockResolvedValue([{paymentId:'SN-PAY-2026-00003',transactionType:'REVERSAL',reversalOf:original._id,amount:60}]);
  const reversal=await financeService.reversePayment({...auth,role:'OWNER_ADMIN'},request,String(original._id),{reason:'Duplicate posting'});
  expect(reversal).toMatchObject({transactionType:'REVERSAL',reversalOf:original._id,amount:60});
  expect(plan.amountPaid).toBe(0);expect(plan.amountDue).toBe(100);expect(mocks.receiptUpdate).toHaveBeenCalled();
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({action:'payment.reverse',reason:'Duplicate posting'}));
 });
 it('scopes payment lookup to the authenticated institute so a foreign payment ID resolves as missing',async()=>{
  await expect(financeService.getPayment(auth,'payment-from-institute-b')).rejects.toMatchObject({statusCode:404,code:'PAYMENT_NOT_FOUND'});
  expect(mocks.paymentFind).toHaveBeenCalledWith({instituteId:auth.instituteId,_id:'payment-from-institute-b'});
 });
});
