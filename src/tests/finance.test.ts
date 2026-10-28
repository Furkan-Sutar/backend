import {describe,expect,it} from 'vitest';
import {assertPaymentWithinDue,calculateDiscount,calculateFee,calculateInstallmentTotal} from '../utils/fee-calculation.js';
import {ROLE_PERMISSIONS} from '../types/rbac.js';
import {calculateCashBook} from '../utils/cash-book.js';

describe('financial calculations and authorization',()=>{
 it('calculates a discounted fee and remaining balance server-side',()=>{
  const discount=calculateDiscount(1200,'PERCENT',10);
  expect(discount).toBe(120);
  expect(calculateFee(1200,discount,300)).toEqual({courseFee:1200,discountAmount:120,finalFee:1080,amountPaid:300,amountDue:780});
 });
 it('accepts full payment and installment schedules only when totals match',()=>{
  expect(assertPaymentWithinDue(780,780)).toBeUndefined();
  expect(calculateInstallmentTotal([360,360,360],1080)).toBe(true);
  expect(()=>calculateInstallmentTotal([500,500],1080)).toThrow(RangeError);
 });
 it('prevents full-plan and installment overpayment, including cents rounding',()=>{
  expect(()=>assertPaymentWithinDue(100.01,100,200)).toThrow(RangeError);
  expect(()=>assertPaymentWithinDue(50,100,49.99)).toThrow(RangeError);
  expect(assertPaymentWithinDue(49.99,100,49.99)).toBeUndefined();
 });
 it('validates discount bounds and final fee boundaries',()=>{
  expect(()=>calculateDiscount(500,'PERCENT',101)).toThrow(RangeError);
  expect(()=>calculateFee(500,501)).toThrow(RangeError);
  expect(()=>calculateFee(500,100,401)).toThrow(RangeError);
 });
 it('limits fee and payment grants to finance roles',()=>{
  expect(ROLE_PERMISSIONS.ACCOUNTANT).toContain('fee.create');
  expect(ROLE_PERMISSIONS.ACCOUNTANT).toContain('payment.create');
  expect(ROLE_PERMISSIONS.ACCOUNTANT).toContain('payment.reverse');
  expect(ROLE_PERMISSIONS.STUDENT).toContain('fee.view');
  expect(ROLE_PERMISSIONS.STUDENT).not.toContain('payment.create');
  expect(ROLE_PERMISSIONS.TEACHER).not.toContain('payment.view');
 });
 it('keeps cash movements separate from collections and expenses',()=>{
  const book=calculateCashBook(100,[
   {direction:'INFLOW',category:'COLLECTION',amount:80},
   {direction:'OUTFLOW',category:'EXPENSE',amount:30},
   {direction:'OUTFLOW',category:'TRANSFER',amount:20},
   {direction:'INFLOW',category:'TRANSFER',amount:20}
  ]);
  expect(book).toMatchObject({openingBalance:100,inflow:100,outflow:50,closingBalance:150,breakdown:{collections:80,expenses:30,transfersIn:20,transfersOut:20}});
  expect(book).not.toHaveProperty('profit');
 });
});
