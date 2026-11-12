const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Use @fastrd/ui-vue primitives in application templates.' },
    schema: [],
    messages: {
      native: '业务模板禁止裸 HTML <{{tag}}>；请使用 @fastrd/ui-vue。',
      escape: '交互元素不能通过 Box/as 绕过组件库，请使用对应控件组件。',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices
    if (!services.defineTemplateBodyVisitor) return {}
    return services.defineTemplateBodyVisitor({
      VElement(node) {
        const name = node.rawName ?? node.name
        if (/^[a-z]/.test(name) && !['template', 'slot'].includes(name)) {
          context.report({
            node: node.startTag,
            messageId: 'native',
            data: { tag: name },
          })
        }
        for (const attribute of node.startTag.attributes) {
          if (
            !attribute.directive &&
            attribute.key.name === 'as' &&
            /^(button|input|select|textarea|option|a|iframe|dialog)$/.test(
              attribute.value?.value ?? '',
            )
          ) {
            context.report({ node: attribute, messageId: 'escape' })
          }
        }
      },
    })
  },
}
export default { rules: { 'no-native-elements': rule } }
