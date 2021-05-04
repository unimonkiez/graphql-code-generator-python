import { Types, PluginFunction } from '@graphql-codegen/plugin-helpers';
import {
  parse,
  visit,
  GraphQLSchema,
  TypeInfo,
  GraphQLNamedType,
  visitWithTypeInfo,
  getNamedType,
  isIntrospectionType,
  DocumentNode,
  printIntrospectionSchema,
  isObjectType,
} from 'graphql';
import { PythonPluginConfig } from './config';
import { transformSchemaAST } from '@graphql-codegen/schema-ast';
import { PythonVisitor } from './visitor';

export const plugin: PluginFunction<PythonPluginConfig, Types.ComplexPluginOutput> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: PythonPluginConfig
) => {
  const { schema: _schema, ast } = transformSchemaAST(schema, config);

  const visitor = new PythonVisitor(_schema, config);

  const visitorResult = visit(ast, { leave: visitor });
//   const introspectionDefinitions = includeIntrospectionDefinitions(_schema, documents, config);
  const scalars = visitor.scalarsDefinition;

  return {
    content: [
        scalars,
        ...visitorResult.definitions,
        // ...introspectionDefinitions,
    ].join('\n'),
  };
};
