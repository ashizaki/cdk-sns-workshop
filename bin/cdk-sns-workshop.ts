#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkSnsWorkshopStack } from '../lib/cdk-sns-workshop-stack';

const app = new cdk.App();
new CdkSnsWorkshopStack(app, 'CdkSnsWorkshopStack');
